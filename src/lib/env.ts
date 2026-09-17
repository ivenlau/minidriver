import type { Hono } from 'hono'

export type Env = {
  R2: R2Bucket
  DB: D1Database
  ASSETS: Fetcher
  /** 主对外地址（用于拼接分享链接、推导 RP ID） */
  APP_PUBLIC_URL: string
  /** 允许的来源，逗号分隔；为空则默认 APP_PUBLIC_URL */
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

export function allowedOrigins(env: Env): string[] {
  const list = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return list.length > 0 ? list : [env.APP_PUBLIC_URL]
}

export function rpID(env: Env): string {
  return new URL(env.APP_PUBLIC_URL).hostname
}
