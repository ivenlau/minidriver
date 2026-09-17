import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import type { Context } from 'hono'
import type { AppEnv } from './env'
import { randomToken, sha256Hex } from './ids'

export const SID_COOKIE = '__Host-sid'

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000
export const SESSION_ABS_MS = 90 * 24 * 3600 * 1000

/** 签发新会话：明文 token 进 Cookie（__Host- 前缀），库里只存 SHA-256 */
export async function createSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const token = randomToken(32)
  const now = Date.now()
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip_country) VALUES (?,?,?,?,?,?,?)',
  )
    .bind(
      await sha256Hex(token),
      userId,
      now,
      now,
      now + SESSION_TTL_MS,
      c.req.header('User-Agent') ?? null,
      c.req.header('CF-IPCountry') ?? null,
    )
    .run()
  setCookie(c, SID_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
}

export async function destroyCurrentSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SID_COOKIE)
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run()
  }
  clearSessionCookie(c)
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  // __Host- 前缀的 Cookie 在 Hono 里同样要求 secure 属性
  deleteCookie(c, SID_COOKIE, { path: '/', secure: true })
}

export function cookieOpts() {
  return { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' } as const
}
