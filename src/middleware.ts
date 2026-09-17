import { getCookie } from 'hono/cookie'
import type { Context, Next } from 'hono'
import { Errors, AppError } from './lib/errors'
import type { AppEnv } from './lib/env'
import { allowedOrigins } from './lib/env'
import { sha256Hex } from './lib/ids'
import { SID_COOKIE, SESSION_ABS_MS, SESSION_TTL_MS } from './lib/session'

const SESSION_RENEW_MS = 24 * 3600 * 1000

export type SessionRow = {
  id: string
  user_id: string
  created_at: number
  last_seen_at: number
  expires_at: number
  user_agent: string | null
  ip_country: string | null
}

/** 变更类请求：校验 Origin（同源策略）+ 自定义头（跨站表单/简单请求无法携带） */
export async function originCheck(c: Context<AppEnv>, next: Next) {
  const method = c.req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next()

  const origin = c.req.header('Origin')
  if (origin && !allowedOrigins(c.env).includes(origin)) {
    throw Errors.forbidden('ORIGIN_NOT_ALLOWED')
  }
  if (c.req.header('x-minidriver') !== '1') throw Errors.forbidden('CSRF')
  return next()
}

/** 会话鉴权；滑动续期：距上次活跃 >24h 时顺延（绝对上限 90 天） */
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const token = getCookie(c, SID_COOKIE)
  if (!token) throw Errors.unauthorized('AUTH_REQUIRED')
  const id = await sha256Hex(token)
  const row = await c.env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<SessionRow>()
  if (!row || row.expires_at <= Date.now()) throw Errors.unauthorized('AUTH_REQUIRED')

  const now = Date.now()
  if (now - row.last_seen_at > SESSION_RENEW_MS && row.created_at + SESSION_ABS_MS > now) {
    await c.env.DB.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .bind(now, now + SESSION_TTL_MS, id)
      .run()
  }
  c.set('userId', row.user_id)
  return next()
}

/** 可选会话：有合法会话则设置 userId，否则匿名放行 */
export async function optionalAuth(c: Context<AppEnv>, next: Next) {
  const token = getCookie(c, SID_COOKIE)
  if (token) {
    const id = await sha256Hex(token)
    const row = await c.env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?').bind(id).first<{
      user_id: string
      expires_at: number
    }>()
    if (row && row.expires_at > Date.now()) c.set('userId', row.user_id)
  }
  return next()
}

export function errorHandler(err: unknown, c: Context<AppEnv>) {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code } }, err.status as never)
  }
  const requestId = crypto.randomUUID()
  console.error(`[minidriver] ${requestId} ${c.req.method} ${c.req.path}`, err)
  return c.json({ error: { code: 'INTERNAL', requestId } }, 500 as never)
}

export function notFoundHandler(c: Context<AppEnv>) {
  return c.json({ error: { code: 'NOT_FOUND' } }, 404 as never)
}
