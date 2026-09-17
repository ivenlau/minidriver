import type { Env } from './lib/env'

/** Cron 每日维护：回收站 30 天清理、遗留分块上传清理、过期分享记录清理 */
export async function runMaintenance(env: Env): Promise<void> {
  const now = Date.now()
  const day = 24 * 3600 * 1000

  // 1) 回收站：删除超过 30 天的节点（先删 R2 对象，再删行）
  const trashCutoff = now - 30 * day
  const trashed = await env.DB.prepare(
    'SELECT id, r2_key, thumb_key FROM nodes WHERE deleted_at IS NOT NULL AND deleted_at < ?',
  )
    .bind(trashCutoff)
    .all<{ r2_key: string | null; thumb_key: string | null }>()
  const keys = (trashed.results ?? []).flatMap((r) => [r.r2_key, r.thumb_key].filter((k): k is string => !!k))
  for (let i = 0; i < keys.length; i += 100) {
    await env.R2.delete(keys.slice(i, i + 100))
  }
  if ((trashed.results ?? []).length > 0) {
    await env.DB.prepare('DELETE FROM nodes WHERE deleted_at IS NOT NULL AND deleted_at < ?').bind(trashCutoff).run()
  }

  // 2) 遗留分块上传：>7 天仍 open → abort 并移除隐藏节点
  const uploadCutoff = now - 7 * day
  const stale = await env.DB.prepare(
    "SELECT id, r2_upload_id FROM uploads WHERE state = 'open' AND created_at < ?",
  )
    .bind(uploadCutoff)
    .all<{ id: string; r2_upload_id: string }>()
  for (const up of stale.results ?? []) {
    const node = await env.DB.prepare('SELECT r2_key FROM nodes WHERE id = ?').bind(up.id).first<{ r2_key: string | null }>()
    if (node?.r2_key) {
      try {
        await env.R2.resumeMultipartUpload(node.r2_key, up.r2_upload_id).abort()
      } catch {
        // 已经 abort 过就忽略
      }
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM uploads WHERE id = ?').bind(up.id),
      env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(up.id),
    ])
  }

  // 3) 失效超过 90 天的分享记录（仅清记录，不影响活跃分享）
  const shareCutoff = now - 90 * day
  await env.DB.prepare(
    'DELETE FROM shares WHERE (revoked_at IS NOT NULL AND revoked_at < ?) '
      + 'OR (expires_at IS NOT NULL AND expires_at < ? AND max_downloads IS NULL AND download_count = 0)',
  )
    .bind(shareCutoff, shareCutoff)
    .run()
}
