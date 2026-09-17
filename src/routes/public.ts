import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { AppEnv } from '../lib/env'
import { Errors } from '../lib/errors'
import { sha256Hex } from '../lib/ids'
import { readSignedValue, verifyPassword, signValue } from '../lib/crypto'
import { serveR2Object, parseRange } from '../lib/r2'
import { cookieOpts } from '../lib/session'
import { readJson } from '../lib/validate'
import { isPreviewable } from '../lib/nodes'
import { shareStatus } from './shares'

/**
 * 公开分享端点（无会话）。
 * 失效/吊销/超限一律 404，不向猜测者泄露具体原因。
 */
export const publicShare = new Hono<AppEnv>()

const SH_COOKIE = '__Host-sh'

type PublicShareRow = {
  id: string
  node_id: string
  password_hash: string | null
  expires_at: number | null
  max_downloads: number | null
  download_count: number
  fail_count: number
  locked_until: number | null
  revoked_at: number | null
  created_at: number
  last_access_at: number | null
  // JOIN nodes
  node_deleted_at: number | null
  name: string
  size: number | null
  mime: string | null
  thumb_key: string | null
  r2_key: string | null
}

async function loadShare(c: { env: AppEnv['Bindings']; req: { param: (k: string) => string } }): Promise<PublicShareRow> {
  const token = c.req.param('token')
  const row = await c.env.DB.prepare(
    `SELECT s.id, s.node_id, s.password_hash, s.expires_at, s.max_downloads, s.download_count,
            s.fail_count, s.locked_until, s.revoked_at, s.created_at, s.last_access_at,
            n.deleted_at AS node_deleted_at, n.name, n.size, n.mime, n.thumb_key, n.r2_key
     FROM shares s JOIN nodes n ON n.id = s.node_id WHERE s.token_hash = ?`,
  )
    .bind(await sha256Hex(token))
    .first<PublicShareRow>()
  if (!row) throw Errors.notFound()
  if (shareStatus(row, Date.now()) !== 'active') throw Errors.notFound()
  if (row.node_deleted_at) throw Errors.notFound()
  if (!row.r2_key || row.size === null) throw Errors.notFound()
  return row
}

/** 密码保护且未解锁 → 404 */
async function requireUnlocked(
  c: { env: AppEnv['Bindings']; req: { param: (k: string) => string } },
  share: PublicShareRow,
): Promise<void> {
  if (!share.password_hash) return
  const payload = await readSignedValue<{ sid: string }>(c.env.SESSION_ENC_KEY, getCookie(c as never, SH_COOKIE))
  if (!payload || payload.sid !== share.id) throw Errors.notFound()
}

publicShare.get('/s/:token/meta', async (c) => {
  const share = await loadShare(c)
  if (share.password_hash) {
    const payload = await readSignedValue<{ sid: string }>(c.env.SESSION_ENC_KEY, getCookie(c, SH_COOKIE))
    if (!payload || payload.sid !== share.id) {
      return c.json({ needPassword: true, expiresAt: share.expires_at })
    }
  }
  return c.json({
    needPassword: false,
    name: share.name,
    size: share.size,
    mime: share.mime,
    hasThumb: !!share.thumb_key,
    expiresAt: share.expires_at,
    previewable: isPreviewable(share.mime),
  })
})

publicShare.post('/s/:token/unlock', async (c) => {
  const share = await loadShare(c)
  if (share.locked_until && share.locked_until > Date.now()) throw Errors.tooMany('SHARE_LOCKED')
  if (!share.password_hash) return c.json({ ok: true })

  const body = await readJson(c)
  const password = typeof body.password === 'string' ? body.password : ''
  if (!(await verifyPassword(password, share.password_hash))) {
    const count = (share.fail_count ?? 0) + 1
    const lock = count >= 5 && count % 5 === 0 ? Date.now() + 15 * 60 * 1000 : share.locked_until
    await c.env.DB.prepare('UPDATE shares SET fail_count = ?, locked_until = ? WHERE id = ?')
      .bind(count, lock, share.id)
      .run()
    throw Errors.unauthorized('SHARE_PASSWORD_INVALID')
  }
  await c.env.DB.prepare('UPDATE shares SET fail_count = 0, locked_until = NULL WHERE id = ?').bind(share.id).run()
  setCookie(
    c,
    SH_COOKIE,
    await signValue(c.env.SESSION_ENC_KEY, { sid: share.id, exp: Date.now() + 3600 * 1000 }),
    cookieOpts(),
  )
  return c.json({
    ok: true,
    meta: {
      name: share.name,
      size: share.size,
      mime: share.mime,
      hasThumb: !!share.thumb_key,
      expiresAt: share.expires_at,
      previewable: isPreviewable(share.mime),
    },
  })
})

publicShare.get('/s/:token/content', async (c) => {
  const share = await loadShare(c)
  await requireUnlocked(c, share)
  const range = parseRange(c.req.header('range'), share.size ?? 0)
  const obj = await c.env.R2.get(share.r2_key!, range ? { range } : undefined)
  if (!obj) throw Errors.notFound()

  // 下载计数：整请求或首块 Range 时 +1
  const rangeHeader = c.req.header('range')
  const isFirstChunk = !rangeHeader || /^bytes=0-/.test(rangeHeader)
  if (isFirstChunk) {
    await c.env.DB.prepare('UPDATE shares SET download_count = download_count + 1, last_access_at = ? WHERE id = ?')
      .bind(Date.now(), share.id)
      .run()
  }
  const download = c.req.query('dl') === '1' || !isPreviewable(share.mime)
  return serveR2Object(obj, { name: share.name, mime: share.mime ?? '', disposition: download ? 'attachment' : 'inline' }, c.req.raw)
})

publicShare.get('/s/:token/thumb', async (c) => {
  const share = await loadShare(c)
  await requireUnlocked(c, share)
  if (!share.thumb_key) throw Errors.notFound()
  const obj = await c.env.R2.get(share.thumb_key)
  if (!obj) throw Errors.notFound()
  return serveR2Object(obj, { name: share.thumb_key, mime: 'image/webp' }, c.req.raw)
})
