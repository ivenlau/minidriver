import type { Hono } from 'hono'

export type Env = {
  R2: R2Bucket
  DB: D1Database
  ASSETS: Fetcher
  /**
   * 规范对外地址（分享链接、Passkey RP ID 的权威来源）。
   * 留空或为占位符时，自动使用当前请求的来源（单域名零配置）。
   * 多域名（如同时绑定自定义域与 workers.dev）时必须填写主域名，
   * 否则两个域名的 RP ID 不同，Passkey 不能互通。
   */
  APP_PUBLIC_URL: string
  /** 允许的来源，逗号分隔；为空则默认 APP_PUBLIC_URL（或请求来源） */
  ALLOWED_ORIGINS?: string
  /** 32B base64：HMAC 签名 Cookie + AES 加密 TOTP secret */
  SESSION_ENC_KEY: string
  SETUP_TOKEN: string
}

export type Vars = {
  userId: string
}

export type AppEnv = { Bindings: Env; Variables: Vars }
export type App = Hono<AppEnv>

function isConfigured(url: string | undefined): boolean {
  return !!url && !url.includes('<your-subdomain>')
}

/** 规范来源：优先配置值，否则回退到当前请求的来源 */
export function publicOrigin(env: Env, requestUrl: string): string {
  return isConfigured(env.APP_PUBLIC_URL) ? env.APP_PUBLIC_URL : new URL(requestUrl).origin
}

/** CSRF / WebAuthn 校验用的来源白名单 */
export function allowedOrigins(env: Env, requestUrl: string): string[] {
  const list = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length > 0 ? list : [publicOrigin(env, requestUrl)]
}

/** WebAuthn RP ID（恒为完整主机名，对任何域名都合法） */
export function rpID(env: Env, requestUrl: string): string {
  return new URL(publicOrigin(env, requestUrl)).hostname
}
