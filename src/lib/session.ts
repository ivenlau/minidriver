import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import type { Context } from 'hono'
import type { AppEnv, Env } from './env'
import { randomToken, sha256Hex } from './ids'
import { sharedAuthDomain } from './env'

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000
export const SESSION_ABS_MS = 90 * 24 * 3600 * 1000

/**
 * 会话 Cookie 名：开启 BASE_DOMAIN_AUTH（跨子域共享认证）时使用根域共享 Cookie（SSO），
 * 否则保持既有 `__Host-sid`（host-only）。根域自动推导，无需手填。
 */
export function sessionCookieName(env: Env, requestUrl: string): string {
  return sharedAuthDomain(env, requestUrl) ? '__Secure-md-session' : '__Host-sid'
}

function sessionCookieOptions(env: Env, requestUrl: string) {
  const base = { httpOnly: true, secure: true, sameSite: 'Lax' as const, path: '/' }
  const domain = sharedAuthDomain(env, requestUrl)
  return domain ? { ...base, domain } : base
}

/** 签发新会话：明文 token 进 Cookie，库里只存 SHA-256 */
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
  setCookie(c, sessionCookieName(c.env, c.req.url), token, sessionCookieOptions(c.env, c.req.url))
}

export async function destroyCurrentSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, sessionCookieName(c.env, c.req.url))
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run()
  }
  clearSessionCookie(c)
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  // __Host- 前缀的 Cookie 在 Hono 里同样要求 secure 属性；父域模式需带 Domain 才能删除
  deleteCookie(c, sessionCookieName(c.env, c.req.url), {
    path: '/',
    secure: true,
    ...(sharedAuthDomain(c.env, c.req.url) ? { domain: sharedAuthDomain(c.env, c.req.url) } : {}),
  })
}

export function cookieOpts() {
  return { httpOnly: true, secure: true, sameSite: 'Lax' as const, path: '/' }
}
