import { Hono } from 'hono'
import type { AppEnv } from '../lib/env'
import { Errors } from '../lib/errors'
import { ulid } from '../lib/ids'
import { serveR2Object } from '../lib/r2'
import { requireAuth } from '../middleware'
import { readJson, validateNodeName } from '../lib/validate'
import { getNode, requireNode, assertNameAvailable, toNodeDto } from '../lib/nodes'

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024 // 10 GB
const MAX_PART_SIZE = 64 * 1024 * 1024
const MAX_PARTS = 10000
const MAX_THUMB_SIZE = 512 * 1024

export const files = new Hono<AppEnv>().use('*', requireAuth)

type UploadRow = { id: string; r2_upload_id: string; state: 'open' | 'completed' | 'aborted' }

/**
 * 分块上传第一步：建节点 + 开启 R2 Multipart。
 * 节点 size 置 NULL，完成前对所有列表隐藏。
 */
files.post('/files/init', async (c) => {
  const body = await readJson(c)
  const name = validateNodeName(body.name)
  const parentId = typeof body.parentId === 'string' && body.parentId ? body.parentId : null
  const mime = typeof body.mime === 'string' && body.mime ? body.mime : 'application/octet-stream'
  const size = typeof body.size === 'number' && Number.isInteger(body.size) && body.size >= 0 ? body.size : -1
  if (size < 0 || size > MAX_FILE_SIZE) throw Errors.badRequest('SIZE_INVALID')
  if (parentId) {
    const parent = await getNode(c.env.DB, parentId)
    if (!parent || parent.type !== 'folder') throw Errors.notFound('NODE_NOT_FOUND')
  }
  await assertNameAvailable(c.env.DB, parentId, name)

  const id = ulid()
  const r2Key = `f/${id}`
  const now = Date.now()
  const mp = await c.env.R2.createMultipartUpload(r2Key, { httpMetadata: { contentType: mime } })

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO nodes (id, type, name, parent_id, mime, r2_key, created_at, updated_at) VALUES (?, 'file', ?, ?, ?, ?, ?, ?)",
    ).bind(id, name, parentId, mime, r2Key, now, now),
    c.env.DB.prepare("INSERT INTO uploads (id, r2_upload_id, state, created_at) VALUES (?, ?, 'open', ?)").bind(
      id,
      mp.uploadId,
      now,
    ),
  ])
  return c.json({ fileId: id, uploadId: mp.uploadId }, 201)
})

/** 上传单个分块（客户端按 8MiB 切块，失败单块重试） */
files.put('/files/:id/parts/:n', async (c) => {
  const node = await requireNode(c.env.DB, c.req.param('id'))
  if (node.type !== 'file' || !node.r2_key) throw Errors.badRequest('NOT_A_FILE')
  const partNumber = parseInt(c.req.param('n'), 10)
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) throw Errors.badRequest('PART_INVALID')

  const up = await c.env.DB.prepare("SELECT * FROM uploads WHERE id = ? AND state = 'open'")
    .bind(node.id)
    .first<UploadRow>()
  if (!up) throw Errors.conflict('UPLOAD_NOT_OPEN')

  const buf = await c.req.arrayBuffer()
  if (buf.byteLength > MAX_PART_SIZE) throw Errors.badRequest('PART_TOO_LARGE')

  const mp = c.env.R2.resumeMultipartUpload(node.r2_key, up.r2_upload_id)
  const part = await mp.uploadPart(partNumber, buf)
  return c.json({ partNumber, etag: part.etag })
})

files.post('/files/:id/complete', async (c) => {
  const body = await readJson(c)
  const node = await requireNode(c.env.DB, c.req.param('id'))
  if (node.type !== 'file' || !node.r2_key) throw Errors.badRequest('NOT_A_FILE')

  const up = await c.env.DB.prepare("SELECT * FROM uploads WHERE id = ? AND state = 'open'")
    .bind(node.id)
    .first<UploadRow>()
  if (!up) throw Errors.conflict('UPLOAD_NOT_OPEN')

  const rawParts = Array.isArray(body.parts) ? body.parts : []
  if (rawParts.length === 0 || rawParts.length > MAX_PARTS) throw Errors.badRequest('PARTS_INVALID')
  const parts = rawParts
    .map((p) => p as { partNumber?: unknown; etag?: unknown })
    .map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag ?? '') }))
    .filter((p) => Number.isInteger(p.partNumber) && p.partNumber >= 1 && p.partNumber <= MAX_PARTS && p.etag)
    .sort((a, b) => a.partNumber - b.partNumber)
  if (parts.length !== rawParts.length) throw Errors.badRequest('PARTS_INVALID')

  const mp = c.env.R2.resumeMultipartUpload(node.r2_key, up.r2_upload_id)
  const completed = await mp.complete(parts)
  const now = Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE nodes SET size = ?, updated_at = ? WHERE id = ?').bind(completed.size, now, node.id),
    c.env.DB.prepare("UPDATE uploads SET state = 'completed' WHERE id = ?").bind(node.id),
  ])
  return c.json(toNodeDto(await requireNode(c.env.DB, node.id)))
})

files.post('/files/:id/abort', async (c) => {
  const node = await requireNode(c.env.DB, c.req.param('id'))
  if (node.type !== 'file' || !node.r2_key) throw Errors.badRequest('NOT_A_FILE')
  const up = await c.env.DB.prepare("SELECT * FROM uploads WHERE id = ? AND state = 'open'")
    .bind(node.id)
    .first<UploadRow>()
  if (up) {
    try {
      c.env.R2.resumeMultipartUpload(node.r2_key, up.r2_upload_id).abort()
    } catch {
      // 已中止/不存在的 upload 忽略
    }
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE uploads SET state = 'aborted' WHERE id = ?").bind(node.id),
      c.env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(node.id),
    ])
  }
  return c.json({ ok: true })
})

/** 小文件（≤8MiB）快速通道：单请求直传 */
files.post('/files/fast', async (c) => {
  const name = validateNodeName(c.req.query('name'))
  const parentId = c.req.query('parentId') || null
  const mime = c.req.query('mime') || 'application/octet-stream'
  if (parentId) {
    const parent = await getNode(c.env.DB, parentId)
    if (!parent || parent.type !== 'folder') throw Errors.notFound('NODE_NOT_FOUND')
  }
  await assertNameAvailable(c.env.DB, parentId, name)

  const buf = await c.req.arrayBuffer()
  if (buf.byteLength > 8 * 1024 * 1024) throw Errors.badRequest('TOO_LARGE_FOR_FAST_PATH')

  const id = ulid()
  await c.env.R2.put(`f/${id}`, buf, { httpMetadata: { contentType: mime } })
  const now = Date.now()
  await c.env.DB.prepare(
    "INSERT INTO nodes (id, type, name, parent_id, size, mime, r2_key, created_at, updated_at) VALUES (?, 'file', ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, name, parentId, buf.byteLength, mime, `f/${id}`, now, now)
    .run()
  return c.json(toNodeDto(await requireNode(c.env.DB, id)), 201)
})

/** 浏览器端生成的缩略图（webp，≤512KB） */
files.put('/files/:id/thumb', async (c) => {
  const node = await requireNode(c.env.DB, c.req.param('id'))
  if (node.type !== 'file') throw Errors.badRequest('NOT_A_FILE')
  if (node.size === null) throw Errors.conflict('UPLOAD_NOT_COMPLETE')

  const buf = await c.req.arrayBuffer()
  if (buf.byteLength > MAX_THUMB_SIZE) throw Errors.badRequest('THUMB_TOO_LARGE')
  const key = `t/${node.id}.webp`
  await c.env.R2.put(key, buf, { httpMetadata: { contentType: 'image/webp' } })
  await c.env.DB.prepare('UPDATE nodes SET thumb_key = ? WHERE id = ?').bind(key, node.id).run()
  return c.json({ ok: true })
})

/** 已完成文件在缺失缩略图时的兜底读取（与节点内容分离，便于缓存策略） */
files.get('/files/:id/thumb', async (c) => {
  const node = await requireNode(c.env.DB, c.req.param('id'))
  if (!node.thumb_key) throw Errors.notFound('NO_THUMBNAIL')
  const obj = await c.env.R2.get(node.thumb_key)
  if (!obj) throw Errors.notFound('NO_THUMBNAIL')
  return serveR2Object(obj, { name: node.thumb_key, mime: 'image/webp' }, c.req.raw)
})
