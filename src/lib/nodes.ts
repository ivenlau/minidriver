import type { AppEnv } from './env'
import { Errors } from './errors'

export type NodeRow = {
  id: string
  type: 'file' | 'folder'
  name: string
  parent_id: string | null
  size: number | null
  mime: string | null
  r2_key: string | null
  thumb_key: string | null
  sha256: string | null
  starred: number
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export type NodeDto = {
  id: string
  type: 'file' | 'folder'
  name: string
  parentId: string | null
  size: number | null
  mime: string | null
  starred: boolean
  hasThumb: boolean
  createdAt: number
  updatedAt: number
  childCount?: number
  childrenSize?: number
  deletedAt?: number | null
  path?: { id: string; name: string }[]
}

export function toNodeDto(n: NodeRow, extra: Partial<NodeDto> = {}): NodeDto {
  return {
    id: n.id,
    type: n.type,
    name: n.name,
    parentId: n.parent_id,
    size: n.size,
    mime: n.mime,
    starred: !!n.starred,
    hasThumb: !!n.thumb_key,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
    ...extra,
  }
}

export async function getNode(db: AppEnv['Bindings']['DB'], id: string): Promise<NodeRow | null> {
  return db.prepare('SELECT * FROM nodes WHERE id = ?').bind(id).first<NodeRow>()
}

export async function requireNode(db: AppEnv['Bindings']['DB'], id: string): Promise<NodeRow> {
  const node = await getNode(db, id)
  if (!node) throw Errors.notFound('NODE_NOT_FOUND')
  return node
}

/** 同级同名（排除自身、忽略回收站内同名） */
export async function assertNameAvailable(
  db: AppEnv['Bindings']['DB'],
  parentId: string | null,
  name: string,
  excludeId?: string,
): Promise<void> {
  const row = await db
    .prepare('SELECT id FROM nodes WHERE parent_id IS ? AND name = ? AND deleted_at IS NULL AND id != ?')
    .bind(parentId, name, excludeId ?? '')
    .first<{ id: string }>()
  if (row) throw Errors.conflict('NAME_CONFLICT')
}

const SUBTREE = `WITH RECURSIVE sub(id) AS (
  SELECT id FROM nodes WHERE id = ?
  UNION ALL
  SELECT n.id FROM nodes n JOIN sub ON n.parent_id = sub.id
)`

/** 面包屑（根 → 节点）；对回收站中的节点同样有效 */
export async function getBreadcrumbs(
  db: AppEnv['Bindings']['DB'],
  id: string,
): Promise<{ id: string; name: string }[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE up(id, name, parent_id, depth) AS (
        SELECT id, name, parent_id, 0 FROM nodes WHERE id = ?
        UNION ALL
        SELECT n.id, n.name, n.parent_id, up.depth + 1 FROM nodes n JOIN up ON n.id = up.parent_id
      ) SELECT id, name FROM up ORDER BY depth DESC`,
    )
    .bind(id)
    .all<{ id: string; name: string }>()
  return results ?? []
}

/** target 是否位于 root 的子树内（用于移动防环：目标目录在待移动节点子树内则拒绝） */
export async function subtreeContains(
  db: AppEnv['Bindings']['DB'],
  rootId: string,
  targetId: string,
): Promise<boolean> {
  const row = await db
    .prepare(`${SUBTREE} SELECT 1 FROM sub WHERE id = ? LIMIT 1`)
    .bind(rootId, targetId)
    .first()
  return !!row
}

/** 预览类型判定（与前端保持一致的简化版） */
export function isPreviewable(mime: string | null): boolean {
  if (!mime) return false
  if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')) return true
  return ['application/pdf', 'text/plain', 'application/json'].includes(mime) || mime.startsWith('text/')
}
