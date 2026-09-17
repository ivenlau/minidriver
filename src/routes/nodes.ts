import { Hono } from 'hono'
import type { AppEnv } from '../lib/env'
import { Errors } from '../lib/errors'
import { ulid, base64urlEncode, base64urlDecode } from '../lib/ids'
import { serveR2Object, parseRange } from '../lib/r2'
import { requireAuth } from '../middleware'
import { readJson, validateNodeName } from '../lib/validate'
import {
  getNode,
  requireNode,
  assertNameAvailable,
  getBreadcrumbs,
  subtreeContains,
  isPreviewable,
  toNodeDto,
  type NodeRow,
} from '../lib/nodes'

type AggRow = NodeRow & { child_count: number | null; children_size: number | null; deleted_at: number | null }

export const nodes = new Hono<AppEnv>().use('*', requireAuth)

// ---------------------------------------------------------------- 列表 / 详情

const SORT_EXPR: Record<string, { expr: string; col: string }> = {
  name: { expr: 'name', col: 'name' },
  size: { expr: 'COALESCE(size, 0)', col: 'size' },
  updated_at: { expr: 'updated_at', col: 'updated_at' },
  created_at: { expr: 'created_at', col: 'created_at' },
}

function encodeCursor(values: unknown[]): string {
  return base64urlEncode(new TextEncoder().encode(JSON.stringify(values)))
}
function decodeCursor(cursor: string | undefined): unknown[] | null {
  if (!cursor) return null
  try {
    const arr = JSON.parse(new TextDecoder().decode(base64urlDecode(cursor)))
    return Array.isArray(arr) ? arr : null
  } catch {
    return null
  }
}

const LIST_SELECT = `SELECT nodes.*, agg.child_count, agg.children_size FROM nodes
  LEFT JOIN (
    SELECT parent_id, COUNT(*) AS child_count, COALESCE(SUM(size), 0) AS children_size
    FROM nodes WHERE deleted_at IS NULL GROUP BY parent_id
  ) agg ON agg.parent_id = nodes.id`

/** 未完成上传（size IS NULL 的文件节点）对所有列表隐藏 */
const VISIBLE = `parent_id IS ? AND deleted_at IS NULL AND (type = 'folder' OR size IS NOT NULL)`

nodes.get('/nodes', async (c) => {
  const parentParam = c.req.query('parent')
  const parentId = parentParam && parentParam !== 'root' ? parentParam : null
  if (parentId) {
    const parent = await getNode(c.env.DB, parentId)
    if (!parent || parent.type !== 'folder') throw Errors.notFound('NODE_NOT_FOUND')
  }
  const sortKey = c.req.query('sort') ?? 'updated_at'
  const sort = SORT_EXPR[sortKey] ?? SORT_EXPR['updated_at']!
  const order = c.req.query('order') === 'asc' ? 'ASC' : 'DESC'
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '100', 10) || 100, 1), 200)
  const cursor = decodeCursor(c.req.query('cursor') ?? undefined)

  let conditions = VISIBLE
  const params: unknown[] = [parentId]
  const kindParam = c.req.query('kind')
  if (kindParam === 'folder' || kindParam === 'file') {
    conditions += ' AND type = ?'
    params.push(kindParam)
  }
  if (cursor && cursor.length === 2) {
    const cmp = order === 'ASC' ? '>' : '<'
    conditions += ` AND (${sort.expr} ${cmp} ? OR (${sort.expr} = ? AND id ${cmp} ?))`
    params.push(cursor[0], cursor[0], cursor[1])
  }

  const { results } = await c.env.DB.prepare(
    `${LIST_SELECT} WHERE nodes.id IN (SELECT id FROM nodes WHERE ${conditions}) ORDER BY ${sort.expr} ${order}, id ${order} LIMIT ?`,
  )
    .bind(...params, limit)
    .all<AggRow>()

  const items = (results ?? []).map((r) =>
    toNodeDto(r, { childCount: r.child_count ?? 0, childrenSize: r.children_size ?? 0 }),
  )
  let nextCursor: string | null = null
  if (items.length === limit) {
    const last = results![results!.length - 1]!
    nextCursor = encodeCursor([(last as unknown as Record<string, unknown>)[sort.col] ?? 0, last.id])
  }
  return c.json({ items, nextCursor })
})

nodes.get('/nodes/:id', async (c) => {
  const node = await requireNode(c.env.DB, c.req.param('id'))
  return c.json(toNodeDto(node, { path: await getBreadcrumbs(c.env.DB, node.id) }))
})

// ---------------------------------------------------------------- 目录 / 变更

nodes.post('/folders', async (c) => {
  const body = await readJson(c)
  const name = validateNodeName(body.name)
  const parentId = typeof body.parentId === 'string' && body.parentId ? body.parentId : null
  if (parentId) {
    const parent = await getNode(c.env.DB, parentId)
    if (!parent || parent.type !== 'folder') throw Errors.notFound('NODE_NOT_FOUND')
  }
  await assertNameAvailable(c.env.DB, parentId, name)
  const now = Date.now()
  const id = ulid()
  await c.env.DB.prepare(
    "INSERT INTO nodes (id, type, name, parent_id, created_at, updated_at) VALUES (?, 'folder', ?, ?, ?, ?)",
  )
    .bind(id, name, parentId, now, now)
    .run()
  return c.json(toNodeDto(await requireNode(c.env.DB, id)), 201)
})

nodes.patch('/nodes/:id', async (c) => {
  const body = await readJson(c)
  const node = await requireNode(c.env.DB, c.req.param('id'))
  if (node.deleted_at) throw Errors.badRequest('IN_TRASH')

  const newName = body.name !== undefined ? validateNodeName(body.name) : null
  const newParentRaw = body.parentId
  const newParent =
    newParentRaw === undefined ? undefined : typeof newParentRaw === 'string' && newParentRaw ? newParentRaw : null
  const starred = typeof body.starred === 'boolean' ? (body.starred ? 1 : 0) : undefined

  const targetParent = newParent === undefined ? node.parent_id : newParent
  if (newParent !== undefined && newParent !== node.parent_id) {
    if (newParent !== null) {
      const target = await getNode(c.env.DB, newParent)
      if (!target || target.type !== 'folder') throw Errors.notFound('NODE_NOT_FOUND')
    }
    if (node.type === 'folder' && newParent && (await subtreeContains(c.env.DB, node.id, newParent))) {
      throw Errors.badRequest('CYCLE_FORBIDDEN')
    }
  }

  const finalName = newName ?? node.name
  if (finalName !== node.name || (newParent !== undefined && newParent !== node.parent_id)) {
    await assertNameAvailable(c.env.DB, targetParent, finalName, node.id)
  }

  await c.env.DB.prepare('UPDATE nodes SET name = ?, parent_id = ?, starred = ?, updated_at = ? WHERE id = ?')
    .bind(
      finalName,
      targetParent,
      starred === undefined ? node.starred : starred,
      Date.now(),
      node.id,
    )
    .run()
  return c.json(toNodeDto(await requireNode(c.env.DB, node.id), { path: await getBreadcrumbs(c.env.DB, node.id) }))
})

/** 软删除进回收站；?hard=1 彻底删除（先删 R2 对象再删行） */
nodes.delete('/nodes/:id', async (c) => {
  const node = await requireNode(c.env.DB, c.req.param('id'))
  const hard = c.req.query('hard') === '1'

  if (hard) {
    const { results } = await c.env.DB.prepare(
      `WITH RECURSIVE sub(id) AS (
        SELECT id FROM nodes WHERE id = ?
        UNION ALL
        SELECT n.id FROM nodes n JOIN sub ON n.parent_id = sub.id
      ) SELECT id, r2_key, thumb_key FROM sub`,
    )
      .bind(node.id)
      .all<{ id: string; r2_key: string | null; thumb_key: string | null }>()
    const keys = (results ?? []).flatMap((r) => [r.r2_key, r.thumb_key].filter((k): k is string => !!k))
    for (let i = 0; i < keys.length; i += 100) {
      await c.env.R2.delete(keys.slice(i, i + 100))
    }
    await c.env.DB.prepare(
      `WITH RECURSIVE sub(id) AS (
        SELECT id FROM nodes WHERE id = ?
        UNION ALL
        SELECT n.id FROM nodes n JOIN sub ON n.parent_id = sub.id
      ) DELETE FROM nodes WHERE id IN (SELECT id FROM sub)`,
    )
      .bind(node.id)
      .run()
    return c.json({ ok: true, hard: true })
  }

  const now = Date.now()
  await c.env.DB.prepare(
    `WITH RECURSIVE sub(id) AS (
      SELECT id FROM nodes WHERE id = ?
      UNION ALL
      SELECT n.id FROM nodes n JOIN sub ON n.parent_id = sub.id
    ) UPDATE nodes SET deleted_at = ? WHERE id IN (SELECT id FROM sub) AND deleted_at IS NULL`,
  )
    .bind(node.id, now)
    .run()
  return c.json({ ok: true })
})

nodes.post('/nodes/:id/restore', async (c) => {
  const node = await requireNode(c.env.DB, c.req.param('id'))
  if (!node.deleted_at) throw Errors.badRequest('NOT_IN_TRASH')

  // 父链已删除 → 恢复到根目录
  let parentId = node.parent_id
  if (parentId) {
    const row = await c.env.DB.prepare(
      `WITH RECURSIVE up(id, parent_id, deleted_at) AS (
        SELECT id, parent_id, deleted_at FROM nodes WHERE id = ?
        UNION ALL
        SELECT n.id, n.parent_id, n.deleted_at FROM nodes n JOIN up ON n.id = up.parent_id
      ) SELECT COUNT(*) AS n FROM up WHERE deleted_at IS NOT NULL`,
    )
      .bind(parentId)
      .first<{ n: number }>()
    if ((row?.n ?? 0) > 0) parentId = null
  }
  const finalParent: string | null = parentId
  const name = await uniqueNameForRestore(c.env.DB, finalParent, node.name, node.id)
  await c.env.DB.prepare(
    `WITH RECURSIVE sub(id) AS (
      SELECT id FROM nodes WHERE id = ?
      UNION ALL
      SELECT n.id FROM nodes n JOIN sub ON n.parent_id = sub.id
    ) UPDATE nodes SET deleted_at = NULL, parent_id = CASE WHEN id = ? THEN ? ELSE parent_id END, name = CASE WHEN id = ? THEN ? ELSE name END WHERE id IN (SELECT id FROM sub)`,
  )
    .bind(node.id, node.id, finalParent, node.id, name)
    .run()
  return c.json(toNodeDto(await requireNode(c.env.DB, node.id)))
})

/** 恢复时若同名冲突，追加 " (2)" 后缀 */
async function uniqueNameForRestore(
  db: AppEnv['Bindings']['DB'],
  parentId: string | null,
  name: string,
  selfId: string,
): Promise<string> {
  const taken = await db
    .prepare('SELECT name FROM nodes WHERE parent_id IS ? AND deleted_at IS NULL AND id != ?')
    .bind(parentId, selfId)
    .all<{ name: string }>()
  const names = new Set((taken.results ?? []).map((r) => r.name))
  if (!names.has(name)) return name
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})${ext}`
    if (!names.has(candidate)) return candidate
  }
  return `${base} (restored)${ext}`
}

// ---------------------------------------------------------------- 内容 / 缩略图

/** 文本内容更新（编辑器保存）：仅小文本，覆盖写 R2 */
const MAX_TEXT_CONTENT = 1024 * 1024

nodes.put('/nodes/:id/content', async (c) => {
  const node = await requireNode(c.env.DB, c.req.param('id'))
  if (node.deleted_at) throw Errors.notFound('NODE_NOT_FOUND')
  if (node.type !== 'file' || !node.r2_key) throw Errors.badRequest('NOT_A_FILE')
  const buf = await c.req.arrayBuffer()
  if (buf.byteLength > MAX_TEXT_CONTENT) throw Errors.badRequest('CONTENT_TOO_LARGE')
  await c.env.R2.put(node.r2_key, buf, { httpMetadata: { contentType: node.mime ?? 'text/plain' } })
  await c.env.DB.prepare('UPDATE nodes SET size = ?, updated_at = ? WHERE id = ?')
    .bind(buf.byteLength, Date.now(), node.id)
    .run()
  return c.json(toNodeDto(await requireNode(c.env.DB, node.id)))
})

nodes.get('/nodes/:id/content', async (c) => {
  // 注意：回收站中的文件（软删除）允许预览与下载，主人随时可查看待删除的内容
  const node = await requireNode(c.env.DB, c.req.param('id'))
  if (node.type !== 'file' || !node.r2_key) throw Errors.badRequest('NOT_A_FILE')
  const range = parseRange(c.req.header('range'), node.size ?? 0)
  const obj = await c.env.R2.get(node.r2_key, range ? { range } : undefined)
  if (!obj) throw Errors.notFound('OBJECT_MISSING')
  const download = c.req.query('dl') === '1' || !isPreviewable(node.mime)
  return serveR2Object(obj, { name: node.name, mime: node.mime ?? '', disposition: download ? 'attachment' : 'inline' }, c.req.raw)
})

nodes.get('/nodes/:id/thumb', async (c) => {
  const node = await requireNode(c.env.DB, c.req.param('id'))
  if (!node.thumb_key) throw Errors.notFound('NO_THUMBNAIL')
  const obj = await c.env.R2.get(node.thumb_key)
  if (!obj) throw Errors.notFound('NO_THUMBNAIL')
  return serveR2Object(obj, { name: node.thumb_key, mime: 'image/webp' }, c.req.raw)
})

// ---------------------------------------------------------------- 聚合视图

nodes.get('/recent', async (c) => {
  const { results } = await c.env.DB.prepare(
    `${LIST_SELECT} WHERE nodes.id IN (SELECT id FROM nodes WHERE deleted_at IS NULL AND (type = 'folder' OR size IS NOT NULL)) ORDER BY updated_at DESC, id DESC LIMIT 50`,
  ).all<AggRow>()
  return c.json({ items: (results ?? []).map((r) => toNodeDto(r, { childCount: r.child_count ?? 0 })) })
})

nodes.get('/starred', async (c) => {
  const { results } = await c.env.DB.prepare(
    `${LIST_SELECT} WHERE nodes.id IN (SELECT id FROM nodes WHERE starred = 1 AND deleted_at IS NULL AND (type = 'folder' OR size IS NOT NULL)) ORDER BY updated_at DESC, id DESC LIMIT 500`,
  ).all<AggRow>()
  return c.json({ items: (results ?? []).map((r) => toNodeDto(r, { childCount: r.child_count ?? 0 })) })
})

nodes.get('/trash', async (c) => {
  const cursor = decodeCursor(c.req.query('cursor') ?? undefined)
  let where = `deleted_at IS NOT NULL AND (parent_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM nodes p WHERE p.id = nodes.parent_id AND p.deleted_at = nodes.deleted_at
  ))`
  const params: unknown[] = []
  if (cursor && cursor.length === 2) {
    where += ' AND (deleted_at < ? OR (deleted_at = ? AND id < ?))'
    params.push(cursor[0], cursor[0], cursor[1])
  }
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM nodes WHERE ${where} ORDER BY deleted_at DESC, id DESC LIMIT 100`,
  )
    .bind(...params)
    .all<NodeRow>()
  const items = []
  for (const r of results ?? []) {
    items.push(toNodeDto(r, { deletedAt: r.deleted_at, path: await getBreadcrumbs(c.env.DB, r.parent_id ?? r.id) }))
  }
  let nextCursor: string | null = null
  if ((results ?? []).length === 100) {
    const last = results![results!.length - 1]!
    nextCursor = encodeCursor([last.deleted_at, last.id])
  }
  return c.json({ items, nextCursor })
})

nodes.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  if (!q) return c.json({ items: [] })
  const escaped = q.replace(/[\\%_]/g, (ch) => `\\${ch}`)
  const { results } = await c.env.DB.prepare(
    `${LIST_SELECT} WHERE nodes.id IN (SELECT id FROM nodes WHERE name LIKE ? ESCAPE '\\' AND deleted_at IS NULL AND (type = 'folder' OR size IS NOT NULL)) ORDER BY updated_at DESC LIMIT 50`,
  )
    .bind(`%${escaped}%`)
    .all<AggRow>()
  return c.json({ items: (results ?? []).map((r) => toNodeDto(r, { childCount: r.child_count ?? 0 })) })
})

nodes.get('/storage', async (c) => {
  const files = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM nodes WHERE type = 'file' AND deleted_at IS NULL",
  ).first<{ n: number; bytes: number }>()
  const folders = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM nodes WHERE type = 'folder' AND deleted_at IS NULL").first<{ n: number }>()
  const trash = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM nodes WHERE deleted_at IS NOT NULL",
  ).first<{ n: number; bytes: number }>()
  return c.json({
    used: files?.bytes ?? 0,
    fileCount: files?.n ?? 0,
    folderCount: folders?.n ?? 0,
    trashCount: trash?.n ?? 0,
    trashBytes: trash?.bytes ?? 0,
  })
})
