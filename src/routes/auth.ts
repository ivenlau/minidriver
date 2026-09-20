import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Context } from 'hono'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server'
import type { AppEnv } from '../lib/env'
import { rpID, allowedOrigins, sharedAuthDomain } from '../lib/env'
import { Errors } from '../lib/errors'
import { ulid, randomToken, sha256Hex, timingSafeEqualHex } from '../lib/ids'
import {
  signValue,
  readSignedValue,
  hashPassword,
  verifyPassword,
  aesEncrypt,
  aesDecrypt,
} from '../lib/crypto'
import { generateTotpSecret, verifyTotpCode, otpauthUri } from '../lib/totp'
import { createSession, destroyCurrentSession, clearSessionCookie, cookieOpts, sessionCookieName } from '../lib/session'
import { assertNotLocked, recordFailure, clearFailures } from '../lib/lockout'
import { requireAuth } from '../middleware'
import { readJson } from '../lib/validate'

type UserRow = {
  id: string
  email: string
  display_name: string
  password_hash: string | null
  totp_secret_enc: string | null
  totp_enabled: number
  created_at: number
  updated_at: number
}

type CredRow = {
  id: string
  user_id: string
  name: string
  public_key: Uint8Array
  counter: number
  transports: string | null
  backed_up: number
  last_used_at: number | null
  created_at: number
}

type SessionRow = {
  id: string
  created_at: number
  last_seen_at: number
  expires_at: number
  user_agent: string | null
  ip_country: string | null
}

const WA_COOKIE = '__Host-wa' // WebAuthn 挑战（HMAC 签名，5 分钟）
const TMP_COOKIE = '__Host-tmp' // 密码通过后等待 TOTP 的临时凭证（5 分钟）

export const auth = new Hono<AppEnv>()

// ---------------------------------------------------------------- 公共端点

/** 应用初始化状态（未登录可访问，仅暴露最小信息） */
auth.get('/bootstrap', async (c) => {
  const user = await c.env.DB.prepare('SELECT * FROM users ORDER BY created_at LIMIT 1').first<UserRow>()
  const out: Record<string, unknown> = {
    initialized: !!user,
    authMethods: { password: !!user?.password_hash, totp: !!user?.totp_enabled },
    // 跨子域共享认证（BASE_DOMAIN_AUTH）：与 Miniblog 共享登录与账号数据的可见信号
    ssoEnabled: !!sharedAuthDomain(c.env, c.req.url),
  }
  const token = getCookie(c, sessionCookieName(c.env, c.req.url))
  if (token && user) {
    const sessionId = await sha256Hex(token)
    const session = await c.env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?')
      .bind(sessionId)
      .first<{ user_id: string; expires_at: number }>()
    if (session && session.expires_at > Date.now()) {
      out.me = {
        userId: user.id,
        email: user.email,
        displayName: user.display_name,
        hasPassword: !!user.password_hash,
        totpEnabled: !!user.totp_enabled,
      }
    }
  }
  return c.json(out)
})

/** 首次初始化：建用户 + 注册第一个 Passkey + 生成恢复码（此后永久关闭） */
auth.post('/setup', async (c) => {
  const body = await readJson(c)
  const existing = await c.env.DB.prepare('SELECT id FROM users LIMIT 1').first()
  if (existing) throw Errors.forbidden('ALREADY_INITIALIZED')

  const token = typeof body.setupToken === 'string' ? body.setupToken : ''
  const ok = timingSafeEqualHex(await sha256Hex(token), await sha256Hex(c.env.SETUP_TOKEN))
  if (!ok) throw Errors.forbidden('SETUP_TOKEN_INVALID')

  const credential = body.credential as RegistrationResponseJSON
  if (!credential?.response) throw Errors.badRequest('BAD_CREDENTIAL')
  const challenge = await readChallenge(c, 'register')
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challenge,
      expectedOrigin: allowedOrigins(c.env, c.req.url),
      expectedRPID: rpID(c.env, c.req.url),
      // 个人设备优先体验：允许未做生物识别的认证器（UP 仍然强制）
      requireUserVerification: false,
    })
  } catch {
    // 库对 origin/RP 不匹配等抛裸 Error，转为可读的业务错误码
    throw Errors.unauthorized('REGISTRATION_FAILED')
  }
  if (!verification.verified || !verification.registrationInfo) throw Errors.unauthorized('REGISTRATION_FAILED')
  const { credential: cred, credentialBackedUp } = verification.registrationInfo

  const userId = ulid()
  const now = Date.now()
  const email = typeof body.email === 'string' && body.email.includes('@') ? body.email.trim() : 'owner@minidriver.local'
  const displayName = typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim() : 'Owner'
  const deviceName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Primary passkey'

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?,?,?,?,?)',
    ).bind(userId, email, displayName, now, now),
    c.env.DB.prepare(
      'INSERT INTO webauthn_credentials (id, user_id, name, public_key, counter, transports, backed_up, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).bind(
      cred.id,
      userId,
      deviceName,
      cred.publicKey,
      cred.counter,
      cred.transports?.join(',') ?? null,
      credentialBackedUp ? 1 : 0,
      now,
    ),
  ])

  const recoveryCodes = await generateRecoveryCodes(c.env.DB, userId)
  await createSession(c, userId)
  return c.json({
    recoveryCodes,
    user: { userId, email, displayName },
  })
})

// ---------------------------------------------------------------- Passkey 登录

/** 初始化阶段的注册选项（无会话；仅在尚无用户时可用） */
auth.get('/auth/webauthn/setup/options', async (c) => {
  const existing = await c.env.DB.prepare('SELECT id FROM users LIMIT 1').first()
  if (existing) throw Errors.forbidden('ALREADY_INITIALIZED')
  const email = c.req.query('email') || 'owner@minidriver.local'
  const options = await generateRegistrationOptions({
    rpName: 'MiniDriver',
    rpID: rpID(c.env, c.req.url),
    userName: email,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  })
  await setChallenge(c, 'register', options.challenge)
  return c.json(options)
})

/** 登录挑战（discoverable credential：不带 allowCredentials，任何本站 passkey 均可） */
auth.get('/auth/webauthn/login/options', async (c) => {
  const user = await c.env.DB.prepare('SELECT id FROM users LIMIT 1').first()
  if (!user) throw Errors.notFound('NOT_INITIALIZED')
  const options = await generateAuthenticationOptions({ rpID: rpID(c.env, c.req.url), userVerification: 'preferred' })
  await setChallenge(c, 'login', options.challenge)
  return c.json(options)
})

auth.post('/auth/webauthn/login', async (c) => {
  const body = await readJson(c)
  const credential = body.credential as AuthenticationResponseJSON
  if (!credential?.id) throw Errors.badRequest('BAD_CREDENTIAL')
  const challenge = await readChallenge(c, 'login')

  const credRow = await c.env.DB.prepare('SELECT * FROM webauthn_credentials WHERE id = ?')
    .bind(credential.id)
    .first<CredRow>()
  if (!credRow) throw Errors.unauthorized('CREDENTIAL_UNKNOWN')

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challenge,
      expectedOrigin: allowedOrigins(c.env, c.req.url),
      expectedRPID: rpID(c.env, c.req.url),
      credential: {
        id: credRow.id,
        publicKey: new Uint8Array(credRow.public_key),
        counter: credRow.counter,
        transports: credRow.transports?.split(',') ?? undefined,
      },
      requireUserVerification: false,
    })
  } catch {
    throw Errors.unauthorized('AUTH_FAILED')
  }
  if (!verification.verified) throw Errors.unauthorized('AUTH_FAILED')

  const { newCounter } = verification.authenticationInfo
  // 计数器单调性检查（防凭证克隆）；不少 passkey 恒为 0，需双方 >0 才判失败
  if (newCounter > 0 && newCounter <= credRow.counter) throw Errors.unauthorized('CREDENTIAL_CLONED')

  await c.env.DB.prepare('UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?')
    .bind(newCounter, Date.now(), credRow.id)
    .run()
  await createSession(c, credRow.user_id)
  return c.json({ ok: true })
})

// ---------------------------------------------------------------- 备用通道：密码 + TOTP

auth.post('/auth/password/login', async (c) => {
  const body = await readJson(c)
  const password = typeof body.password === 'string' ? body.password : ''
  const user = await c.env.DB.prepare('SELECT * FROM users ORDER BY created_at LIMIT 1').first<UserRow>()
  // 统一 401，不透露该账号是否启用密码登录
  if (!user?.password_hash) throw Errors.unauthorized('BAD_CREDENTIALS')
  const lockKey = `pw:${user.id}`
  await assertNotLocked(c.env.DB, lockKey)

  if (!(await verifyPassword(password, user.password_hash))) {
    await recordFailure(c.env.DB, lockKey)
    throw Errors.unauthorized('BAD_CREDENTIALS')
  }
  await clearFailures(c.env.DB, lockKey)

  if (user.totp_enabled && user.totp_secret_enc) {
    setCookie(
      c,
      TMP_COOKIE,
      await signValue(c.env.SESSION_ENC_KEY, { purpose: 'totp', userId: user.id, exp: Date.now() + 5 * 60 * 1000 }),
      cookieOpts(),
    )
    return c.json({ needTotp: true })
  }
  await createSession(c, user.id)
  return c.json({ ok: true })
})

auth.post('/auth/totp/verify', async (c) => {
  const body = await readJson(c)
  const p = await readSignedValue<{ purpose: string; userId: string }>(
    c.env.SESSION_ENC_KEY,
    getCookie(c, TMP_COOKIE),
  )
  if (!p || p.purpose !== 'totp') throw Errors.unauthorized('CHALLENGE_EXPIRED')
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(p.userId).first<UserRow>()
  if (!user?.totp_enabled || !user.totp_secret_enc) throw Errors.badRequest('TOTP_NOT_ENABLED')

  const lockKey = `totp:${user.id}`
  await assertNotLocked(c.env.DB, lockKey)
  const secret = await aesDecrypt(c.env.SESSION_ENC_KEY, user.totp_secret_enc)
  if (!(await verifyTotpCode(secret, typeof body.code === 'string' ? body.code : ''))) {
    await recordFailure(c.env.DB, lockKey)
    throw Errors.unauthorized('BAD_CODE')
  }
  await clearFailures(c.env.DB, lockKey)
  deleteCookie(c, TMP_COOKIE, { path: '/', secure: true })
  await createSession(c, user.id)
  return c.json({ ok: true })
})

/** 恢复码登录（丢失所有设备时的逃生通道） */
auth.post('/auth/recover', async (c) => {
  const body = await readJson(c)
  const user = await c.env.DB.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').first<{ id: string }>()
  if (!user) throw Errors.notFound('NOT_INITIALIZED')
  const lockKey = `recover:${user.id}`
  await assertNotLocked(c.env.DB, lockKey)

  const code = normalizeRecoveryCode(typeof body.code === 'string' ? body.code : '')
  const row = await c.env.DB.prepare(
    'SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
  )
    .bind(user.id, await sha256Hex(code))
    .first<{ id: string }>()
  if (!row) {
    await recordFailure(c.env.DB, lockKey)
    throw Errors.unauthorized('BAD_CODE')
  }
  await c.env.DB.prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ?').bind(Date.now(), row.id).run()
  await clearFailures(c.env.DB, lockKey)
  await createSession(c, user.id)
  return c.json({ ok: true })
})

// ---------------------------------------------------------------- 会话管理

auth.post('/auth/logout', async (c) => {
  await destroyCurrentSession(c)
  return c.json({ ok: true })
})

auth.get('/auth/me', requireAuth, async (c) => {
  const user = await requireUser(c)
  const passkeys = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id = ?')
    .bind(user.id)
    .first<{ n: number }>()
  const codes = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL',
  )
    .bind(user.id)
    .first<{ n: number }>()
  return c.json({
    userId: user.id,
    email: user.email,
    displayName: user.display_name,
    hasPassword: !!user.password_hash,
    totpEnabled: !!user.totp_enabled,
    passkeyCount: passkeys?.n ?? 0,
    recoveryCodesLeft: codes?.n ?? 0,
  })
})

auth.get('/auth/sessions', requireAuth, async (c) => {
  const token = getCookie(c, sessionCookieName(c.env, c.req.url))
  const currentId = token ? await sha256Hex(token) : ''
  const { results } = await c.env.DB.prepare(
    'SELECT id, created_at, last_seen_at, expires_at, user_agent, ip_country FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC',
  )
    .bind(c.get('userId'))
    .all<SessionRow>()
  const now = Date.now()
  return c.json({
    sessions: (results ?? [])
      .filter((s) => s.expires_at > now)
      .map((s) => ({ ...s, isCurrent: s.id === currentId })),
  })
})

auth.delete('/auth/sessions/:id', requireAuth, async (c) => {
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('userId'))
    .run()
  return c.json({ ok: true })
})

auth.post('/auth/sessions/revoke-others', requireAuth, async (c) => {
  const token = getCookie(c, sessionCookieName(c.env, c.req.url))
  const currentId = token ? await sha256Hex(token) : ''
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
    .bind(c.get('userId'), currentId)
    .run()
  return c.json({ ok: true })
})

// ---------------------------------------------------------------- Passkey 管理

auth.get('/auth/webauthn/register/options', requireAuth, async (c) => {
  const user = await requireUser(c)
  const existing = await c.env.DB.prepare('SELECT id, transports FROM webauthn_credentials WHERE user_id = ?')
    .bind(user.id)
    .all<{ id: string; transports: string | null }>()
  const options = await generateRegistrationOptions({
    rpName: 'MiniDriver',
    rpID: rpID(c.env, c.req.url),
    userName: user.email,
    userDisplayName: user.display_name,
    attestationType: 'none',
    excludeCredentials: (existing.results ?? []).map((r) => ({
      id: r.id,
      transports: r.transports?.split(',') ?? undefined,
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  })
  await setChallenge(c, 'register', options.challenge)
  return c.json(options)
})

auth.post('/auth/webauthn/register', requireAuth, async (c) => {
  const body = await readJson(c)
  const credential = body.credential as RegistrationResponseJSON
  if (!credential?.response) throw Errors.badRequest('BAD_CREDENTIAL')
  const challenge = await readChallenge(c, 'register')
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challenge,
      expectedOrigin: allowedOrigins(c.env, c.req.url),
      expectedRPID: rpID(c.env, c.req.url),
      requireUserVerification: false,
    })
  } catch {
    throw Errors.unauthorized('REGISTRATION_FAILED')
  }
  if (!verification.verified || !verification.registrationInfo) throw Errors.unauthorized('REGISTRATION_FAILED')
  const { credential: cred, credentialBackedUp } = verification.registrationInfo
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Passkey'
  // 同一认证器重复注册（如 iOS 静默返回已有凭证）时给出明确错误而非唯一键冲突 500
  const existing = await c.env.DB.prepare('SELECT id FROM webauthn_credentials WHERE id = ?')
    .bind(cred.id)
    .first<{ id: string }>()
  if (existing) throw Errors.conflict('CREDENTIAL_EXISTS')
  await c.env.DB.prepare(
    'INSERT INTO webauthn_credentials (id, user_id, name, public_key, counter, transports, backed_up, created_at) VALUES (?,?,?,?,?,?,?,?)',
  )
    .bind(
      cred.id,
      c.get('userId'),
      name,
      cred.publicKey,
      cred.counter,
      cred.transports?.join(',') ?? null,
      credentialBackedUp ? 1 : 0,
      Date.now(),
    )
    .run()
  return c.json({ ok: true, id: cred.id })
})

auth.get('/auth/credentials', requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, backed_up, last_used_at, created_at, transports FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at',
  )
    .bind(c.get('userId'))
    .all<CredRow>()
  return c.json({
    credentials: (results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      backedUp: !!r.backed_up,
      lastUsedAt: r.last_used_at,
      createdAt: r.created_at,
    })),
  })
})

auth.patch('/auth/credentials/:id', requireAuth, async (c) => {
  const body = await readJson(c)
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null
  if (!name) throw Errors.badRequest('NAME_INVALID')
  await c.env.DB.prepare('UPDATE webauthn_credentials SET name = ? WHERE id = ? AND user_id = ?')
    .bind(name, c.req.param('id'), c.get('userId'))
    .run()
  return c.json({ ok: true })
})

auth.delete('/auth/credentials/:id', requireAuth, async (c) => {
  const user = await requireUser(c)
  const passkeys = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id = ?')
    .bind(user.id)
    .first<{ n: number }>()
  if ((passkeys?.n ?? 0) <= 1 && !user.password_hash) throw Errors.badRequest('LAST_METHOD')
  await c.env.DB.prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id)
    .run()
  return c.json({ ok: true })
})

// ---------------------------------------------------------------- 密码 / TOTP / 恢复码

auth.put('/auth/password', requireAuth, async (c) => {
  const body = await readJson(c)
  const user = await requireUser(c)
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
  if (newPassword.length < 8) throw Errors.badRequest('WEAK_PASSWORD')
  if (user.password_hash) {
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : ''
    if (!(await verifyPassword(current, user.password_hash))) throw Errors.unauthorized('BAD_CREDENTIALS')
  }
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .bind(await hashPassword(newPassword), Date.now(), user.id)
    .run()
  return c.json({ ok: true })
})

auth.delete('/auth/password', requireAuth, async (c) => {
  const body = await readJson(c)
  const user = await requireUser(c)
  if (!user.password_hash) throw Errors.badRequest('NOT_FOUND')
  const current = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  if (!(await verifyPassword(current, user.password_hash))) throw Errors.unauthorized('BAD_CREDENTIALS')
  const passkeys = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id = ?')
    .bind(user.id)
    .first<{ n: number }>()
  if ((passkeys?.n ?? 0) < 1) throw Errors.badRequest('LAST_METHOD')
  await c.env.DB.prepare('UPDATE users SET password_hash = NULL, updated_at = ? WHERE id = ?')
    .bind(Date.now(), user.id)
    .run()
  return c.json({ ok: true })
})

/** 生成新 TOTP secret（未启用状态，需 confirm 后生效） */
auth.post('/auth/totp/setup', requireAuth, async (c) => {
  const user = await requireUser(c)
  const secret = generateTotpSecret()
  await c.env.DB.prepare('UPDATE users SET totp_secret_enc = ?, updated_at = ? WHERE id = ?')
    .bind(await aesEncrypt(c.env.SESSION_ENC_KEY, secret), Date.now(), user.id)
    .run()
  return c.json({ secret, otpauthUri: otpauthUri(secret, user.email) })
})

auth.post('/auth/totp/confirm', requireAuth, async (c) => {
  const body = await readJson(c)
  const user = await requireUser(c)
  if (!user.totp_secret_enc) throw Errors.badRequest('TOTP_NOT_SETUP')
  const secret = await aesDecrypt(c.env.SESSION_ENC_KEY, user.totp_secret_enc)
  if (!(await verifyTotpCode(secret, typeof body.code === 'string' ? body.code : ''))) {
    throw Errors.unauthorized('BAD_CODE')
  }
  await c.env.DB.prepare('UPDATE users SET totp_enabled = 1, updated_at = ? WHERE id = ?')
    .bind(Date.now(), user.id)
    .run()
  return c.json({ ok: true })
})

auth.delete('/auth/totp', requireAuth, async (c) => {
  const body = await readJson(c)
  const user = await requireUser(c)
  if (!user.totp_enabled) throw Errors.badRequest('TOTP_NOT_ENABLED')
  // 关闭 TOTP 需要当前密码或有效验证码之一
  let ok = false
  if (user.password_hash && typeof body.currentPassword === 'string') {
    ok = await verifyPassword(body.currentPassword, user.password_hash)
  }
  if (!ok && user.totp_secret_enc) {
    const secret = await aesDecrypt(c.env.SESSION_ENC_KEY, user.totp_secret_enc)
    ok = await verifyTotpCode(secret, typeof body.code === 'string' ? body.code : '')
  }
  if (!ok) throw Errors.unauthorized('BAD_CREDENTIALS')
  await c.env.DB.prepare('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, updated_at = ? WHERE id = ?')
    .bind(Date.now(), user.id)
    .run()
  return c.json({ ok: true })
})

auth.post('/auth/recovery/regenerate', requireAuth, async (c) => {
  const codes = await generateRecoveryCodes(c.env.DB, c.get('userId'))
  return c.json({ recoveryCodes: codes })
})

// ---------------------------------------------------------------- 内部工具

async function requireUser(c: { env: AppEnv['Bindings']; get: (k: 'userId') => string }): Promise<UserRow> {
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.get('userId')).first<UserRow>()
  if (!user) throw Errors.unauthorized('AUTH_REQUIRED')
  return user
}

async function setChallenge(c: Context<AppEnv>, purpose: 'register' | 'login', challenge: string) {
  setCookie(
    c,
    WA_COOKIE,
    await signValue(c.env.SESSION_ENC_KEY, { purpose, challenge, exp: Date.now() + 5 * 60 * 1000 }),
    cookieOpts(),
  )
}

async function readChallenge(c: Context<AppEnv>, purpose: 'register' | 'login'): Promise<string> {
  const p = await readSignedValue<{ purpose: string; challenge: string }>(
    c.env.SESSION_ENC_KEY,
    getCookie(c, WA_COOKIE),
  )
  if (!p || p.purpose !== purpose) throw Errors.unauthorized('CHALLENGE_EXPIRED')
  return p.challenge
}

/** 10 个一次性恢复码（xxxx-xxxx-xxxx），只返回明文一次 */
async function generateRecoveryCodes(db: AppEnv['Bindings']['DB'], userId: string): Promise<string[]> {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
  const codes: string[] = []
  const stmts = [db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').bind(userId)] // audit-ok：下方 db.batch(stmts) 统一执行
  for (let i = 0; i < 10; i++) {
    const raw = randomToken(12).replace(/[-_]/g, 'A')
    let s = ''
    for (let j = 0; j < 12; j++) s += alphabet[raw.charCodeAt(j) % alphabet.length]
    const code = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`
    codes.push(code)
    stmts.push(
      db.prepare('INSERT INTO recovery_codes (id, user_id, code_hash) VALUES (?,?,?)').bind(
        ulid(),
        userId,
        await sha256Hex(normalizeRecoveryCode(code)),
      ),
    )
  }
  await db.batch(stmts)
  return codes
}

function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}
