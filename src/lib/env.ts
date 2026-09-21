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
  /**
   * 跨子域共享认证（SSO）：设为 "true" 时，Passkey RP 与会话 Cookie 自动统一到
   * APP_PUBLIC_URL（或请求域）的根域——与 Miniblog 都开启且同根域即互通。
   * 常规根域自动推导（含 com.cn/co.uk 等常见多级后缀）；PSL 托管域（如 github.io）
   * 浏览器本身不允许跨子域，请保持关闭。
   */
  BASE_DOMAIN_AUTH?: string
}

export type Vars = {
  userId: string
}

export type AppEnv = { Bindings: Env; Variables: Vars }
export type App = Hono<AppEnv>

/**
 * 规范来源：优先配置值，否则回退到当前请求的来源。
 * 配置值做容错处理：trim、自动补 https:// 前缀（手填漏协议是高频错误）、
 * 解析失败（非法值）时回退请求来源并告警——绝不让配置错误演变成写操作 500。
 */
export function publicOrigin(env: Env, requestUrl: string): string {
  const raw = env.APP_PUBLIC_URL?.trim()
  if (raw && !raw.includes('<your-subdomain>')) {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    try {
      return new URL(withScheme).origin
    } catch {
      console.warn(`[config] APP_PUBLIC_URL 无效（"${raw}"），已回退到请求来源`)
    }
  }
  return new URL(requestUrl).origin
}

/** CSRF / WebAuthn 校验用的来源白名单 */
export function allowedOrigins(env: Env, requestUrl: string): string[] {
  const list = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length > 0 ? list : [publicOrigin(env, requestUrl)]
}

/**
 * 跨子域共享认证开启时的共享域（BASE_DOMAIN_AUTH="true"）；未开启返回 undefined。
 * 共享域 = 主机名去掉第一段（a.b.c.d → b.c.d；不足三段回退自身）——
 * 部署域名即「根域 + 一段前缀」（如 f./b./blog.），公共后缀由使用者保证。
 */
export function sharedAuthDomain(env: Env, requestUrl: string): string | undefined {
  if (env.BASE_DOMAIN_AUTH !== 'true') return undefined
  const host = new URL(publicOrigin(env, requestUrl)).hostname
  const labels = host.split('.').filter(Boolean)
  return labels.length < 3 ? host : labels.slice(1).join('.')
}

/** WebAuthn RP ID：跨子域共享认证开启时统一根域，否则完整主机名 */
export function rpID(env: Env, requestUrl: string): string {
  return sharedAuthDomain(env, requestUrl) ?? new URL(publicOrigin(env, requestUrl)).hostname
}
