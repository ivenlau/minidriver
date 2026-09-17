/** RFC 6238 TOTP（Web Crypto HMAC-SHA-1），纯实现无依赖 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function generateTotpSecret(bytes = 20): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  let acc = 0
  let bits = 0
  let out = ''
  for (const b of buf) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(acc >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(acc << (5 - bits)) & 31]
  return out
}

function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let acc = 0
  let bits = 0
  const out: number[] = []
  for (const ch of clean) {
    acc = (acc << 5) | B32.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((acc >>> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

export function totpCodeAt(secretB32: string, step = 30, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / step)
  const msg = new Uint8Array(8)
  let c = counter
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff
    c = Math.floor(c / 256)
  }
  return hmacSha1(secretB32, msg)
}

function hmacSha1(secretB32: string, msg: Uint8Array): string {
  // 同步实现不可行，HMAC-SHA1 必须 await；见 verifyTotp / verifyTotpCode
  throw new Error('use verifyTotpCode')
}

export async function verifyTotpCode(secretB32: string, code: string, window = 1, step = 30): Promise<boolean> {
  const normalized = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(normalized)) return false
  const keyBytes = base32Decode(secretB32)
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const base = Math.floor(Date.now() / 1000 / step)
  for (let err = -window; err <= window; err++) {
    const counter = base + err
    const msg = new Uint8Array(8)
    let c = counter
    for (let i = 7; i >= 0; i--) {
      msg[i] = c & 0xff
      c = Math.floor(c / 256)
    }
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
    const offset = mac[mac.length - 1]! & 0x0f
    const bin =
      ((mac[offset]! & 0x7f) << 24) |
      (mac[offset + 1]! << 16) |
      (mac[offset + 2]! << 8) |
      mac[offset + 3]!
    const candidate = String(bin % 1_000_000).padStart(6, '0')
    // 恒定时间比较
    let diff = 0
    for (let i = 0; i < 6; i++) diff |= candidate.charCodeAt(i) ^ normalized.charCodeAt(i)
    if (diff === 0) return true
  }
  return false
}

export function otpauthUri(secret: string, account: string, issuer = 'MiniDriver'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  })
  return `otpauth://totp/${label}?${params}`
}
