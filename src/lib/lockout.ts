import { Errors } from './errors'

/**
 * auth_locks 表的失败锁定逻辑：连续 max 次失败锁 15 分钟。
 * key 形如 'pw:<userId>' / 'totp:<userId>' / 'recover:<userId>' / 'share:<shareId>'
 */

const MAX_FAILS = 5
const LOCK_MS = 15 * 60 * 1000

export async function assertNotLocked(db: D1Database, key: string): Promise<void> {
  const row = await db.prepare('SELECT fail_count, locked_until FROM auth_locks WHERE key = ?').bind(key).first<{
    fail_count: number
    locked_until: number | null
  }>()
  if (row?.locked_until && row.locked_until > Date.now()) {
    throw Errors.tooMany('TRY_LATER')
  }
}

/** 记录一次失败；达到阈值时锁定。返回当前失败次数 */
export async function recordFailure(db: D1Database, key: string): Promise<number> {
  const now = Date.now()
  const row = await db
    .prepare(
      'INSERT INTO auth_locks (key, fail_count, locked_until, updated_at) VALUES (?, 1, NULL, ?) '
        + 'ON CONFLICT(key) DO UPDATE SET fail_count = fail_count + 1, updated_at = excluded.updated_at '
        + 'RETURNING fail_count',
    )
    .bind(key, now)
    .first<{ fail_count: number }>()
  const count = row?.fail_count ?? 1
  if (count >= MAX_FAILS && count % MAX_FAILS === 0) {
    await db.prepare('UPDATE auth_locks SET locked_until = ? WHERE key = ?').bind(now + LOCK_MS, key).run()
  }
  return count
}

export async function clearFailures(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM auth_locks WHERE key = ?').bind(key).run()
}
