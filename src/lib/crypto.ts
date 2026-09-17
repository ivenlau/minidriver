import { base64urlDecode, base64urlEncode, randomToken } from './ids'

const enc = new TextEncoder()

// ---------- HMAC 签名 Cookie（无状态挑战/解锁凭证） ----------

async function hmacKey(secretB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64urlDecodeOrB64(secretB64), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

// 兼容标准 base64（wrangler secret 常见格式）与 base64url
function base64urlDecodeOrB64(s: string): Uint8Array {
  try {
    return base64urlDecode(s)
  } catch {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
}

export async function hmacSign(secretB64: string, data: string): Promise<string> {
  const key = await hmacKey(secretB64)
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return base64urlEncode(new Uint8Array(sig))
}

export async function hmacVerify(secretB64: string, data: string, sigB64url: string): Promise<boolean> {
  const key = await hmacKey(secretB64)
  const expected = base64urlDecode(sigB64url)
  const actual = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
  if (expected.length !== actual.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= expected[i]! ^ actual[i]!
  return diff === 0
}

export type SignedPayload = Record<string, unknown> & { exp: number }

/** 生成 "payload.sig" 形式的签名值（payload 含 exp 过期时间，毫秒） */
export async function signValue(secretB64: string, payload: SignedPayload): Promise<string> {
  const body = base64urlEncode(enc.encode(JSON.stringify(payload)))
  return `${body}.${await hmacSign(secretB64, body)}`
}

export async function readSignedValue<T>(
  secretB64: string,
  value: string | undefined,
): Promise<(T & SignedPayload) | null> {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const body = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  if (!(await hmacVerify(secretB64, body, sig))) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(body))) as T & SignedPayload
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

// ---------- PBKDF2 密码哈希 ----------

// ⚠️ 生产 workerd 对 PBKDF2 迭代数有 100,000 次硬上限（超过直接 NotSupportedError）。
// 取上限值；密码仅作为 Passkey 的备用通道，配合失败锁定（5 次锁 15 分钟）足以兜底。
// 哈希格式为 pbkdf2$<iterations>$<salt>$<hash>，迭代数随哈希存储，未来可平滑调整。
const PBKDF2_ITERATIONS = 100_000

export async function hashPassword(password: string): Promise<string> {
  const salt = base64urlDecode(randomToken(16))
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = parseInt(parts[1]!, 10)
  const salt = b64d(parts[2]!)
  const expected = b64d(parts[3]!)
  const hash = await pbkdf2(password, salt, iterations)
  if (hash.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < hash.length; i++) diff |= hash[i]! ^ expected[i]!
  return diff === 0
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

function b64(buf: Uint8Array): string {
  let s = ''
  for (const b of buf) s += String.fromCharCode(b)
  return btoa(s)
}
function b64d(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ---------- AES-GCM（TOTP secret 静态加密） ----------

export async function aesEncrypt(secretB64: string, plaintext: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', base64urlDecodeOrB64(secretB64), 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return b64(out)
}

export async function aesDecrypt(secretB64: string, storedB64: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', base64urlDecodeOrB64(secretB64), 'AES-GCM', false, ['decrypt'])
  const data = b64d(storedB64)
  const iv = data.slice(0, 12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data.slice(12))
  return new TextDecoder().decode(pt)
}
