import { Hono } from 'hono'
import type { AppEnv } from '../lib/env'
import { publicOrigin } from '../lib/env'
import { Errors } from '../lib/errors'
import { ulid, randomToken, sha256Hex } from '../lib/ids'
import { hashPassword } from '../lib/crypto'
import { requireAuth } from '../middleware'
import { readJson } from '../lib/validate'
import { requireNode } from '../lib/nodes'

export const shares = new Hono<AppEnv>().use('*', requireAuth)

type ShareRow = {
  id: string
  node_id: string
  token_hash: string
  password_hash: string | null
  expires_at: number | null
  max_downloads: number | null
  download_count: number
  revoked_at: number | null
  created_at: number
  last_access_at: number | null
  // JOIN nodes
  name?: string
  size?: number | null
  mime?: string | null
  type?: 'file' | 'folder'
}

type ShareStatusFields = {
  revoked_at: number | null
  expires_at: number | null
  max_downloads: number | null
  download_count: number
}

export function shareStatus(s: ShareStatusFields, now: number): 'active' | 'expired' | 'exhausted' | 'revoked' {
  if (s.revoked_at) return 'revoked'
  if (s.expires_at && s.expires_at <= now) return 'expired'
  if (s.max_downloads !== null && s.download_count >= s.max_downloads) return 'exhausted'
  return 'active'
}

function shareDto(s: ShareRow, now: number) {
  return {
    id: s.id,
    nodeId: s.node_id,
    name: s.name ?? '',
    size: s.size ?? null,
    mime: s.mime ?? null,
    hasPassword: !!s.password_hash,
    expiresAt: s.expires_at,
    maxDownloads: s.max_downloads,
    downloadCount: s.download_count,
    status: shareStatus(s, now),
    createdAt: s.created_at,
    lastAccessAt: s.last_access_at,
  }
}

shares.get('/shares', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, n.name, n.size, n.mime, n.type FROM shares s JOIN nodes n ON n.id = s.node_id
     WHERE s.revoked_at IS NULL OR s.revoked_at > ?
     ORDER BY s.created_at DESC LIMIT 500`,
  )
    .bind(Date.now() - 30 * 86400 * 1000)
    .all<ShareRow>()
  const now = Date.now()
  return c.json({ items: (results ?? []).map((s) => shareDto(s, now)) })
})

/** 创建分享；明文 token 只在本次响应中出现 */
shares.post('/shares', async (c) => {
  const body = await readJson(c)
  const node = await requireNode(c.env.DB, String(body.nodeId ?? ''))
  if (node.deleted_at) throw Errors.notFound('NODE_NOT_FOUND')
  if (node.type !== 'file' || node.size === null) throw Errors.badRequest('NOT_A_FILE')

  const expiresIn = Number(body.expiresIn)
  if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 366 * 86400) {
    throw Errors.badRequest('EXPIRY_INVALID')
  }
  const maxDownloads =
    body.maxDownloads === null || body.maxDownloads === undefined
      ? null
      : Number(body.maxDownloads)
  if (maxDownloads !== null && (!Number.isInteger(maxDownloads) || maxDownloads < 1 || maxDownloads > 100000)) {
    throw Errors.badRequest('MAX_DOWNLOADS_INVALID')
  }
  let passwordHash: string | null = null
  if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.length > 128) throw Errors.badRequest('PASSWORD_TOO_LONG')
    passwordHash = await hashPassword(body.password)
  }

  const token = randomToken(24)
  const now = Date.now()
  const id = ulid()
  await c.env.DB.prepare(
    'INSERT INTO shares (id, node_id, token_hash, password_hash, expires_at, max_downloads, created_at) VALUES (?,?,?,?,?,?,?)',
  )
    .bind(id, node.id, await sha256Hex(token), passwordHash, now + expiresIn * 1000, maxDownloads, now)
    .run()

  const base = publicOrigin(c.env, c.req.url).replace(/\/+$/, '')
  return c.json({ id, token, url: `${base}/s/${token}`, expiresAt: now + expiresIn * 1000 }, 201)
})

shares.patch('/shares/:id', async (c) => {
  const body = await readJson(c)
  const row = await c.env.DB.prepare('SELECT * FROM shares WHERE id = ?').bind(c.req.param('id')).first<ShareRow>()
  if (!row) throw Errors.notFound('SHARE_NOT_FOUND')

  const updates: string[] = []
  const params: unknown[] = []
  if (body.expiresIn !== undefined) {
    const expiresIn = Number(body.expiresIn)
    if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 366 * 86400) {
      throw Errors.badRequest('EXPIRY_INVALID')
    }
    updates.push('expires_at = ?')
    params.push(Date.now() + expiresIn * 1000)
  }
  if (body.password !== undefined) {
    if (body.password === null || body.password === '') {
      updates.push('password_hash = NULL')
    } else {
      if (typeof body.password !== 'string' || body.password.length > 128) throw Errors.badRequest('PASSWORD_TOO_LONG')
      updates.push('password_hash = ?')
      params.push(await hashPassword(body.password))
    }
    updates.push('fail_count = 0', 'locked_until = NULL')
  }
  if (body.maxDownloads !== undefined) {
    const md = body.maxDownloads === null ? null : Number(body.maxDownloads)
    if (md !== null && (!Number.isInteger(md) || md < 1 || md > 100000)) throw Errors.badRequest('MAX_DOWNLOADS_INVALID')
    updates.push('max_downloads = ?')
    params.push(md)
  }
  if (updates.length === 0) throw Errors.badRequest('NOTHING_TO_UPDATE')
  await c.env.DB.prepare(`UPDATE shares SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...params, row.id)
    .run()
  return c.json({ ok: true })
})

shares.delete('/shares/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT id FROM shares WHERE id = ?').bind(c.req.param('id')).first()
  if (!row) throw Errors.notFound('SHARE_NOT_FOUND')
  await c.env.DB.prepare('UPDATE shares SET revoked_at = ? WHERE id = ?').bind(Date.now(), c.req.param('id')).run()
  return c.json({ ok: true })
})
