/** ULID：48bit 毫秒时间 + 80bit 随机，Crockford Base32，可按字典序排序 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function ulid(now = Date.now()): string {
  let time = now
  let ts = ''
  for (let i = 0; i < 10; i++) {
    ts = CROCKFORD[time % 32] + ts
    time = Math.floor(time / 32)
  }
  const rand = new Uint8Array(16)
  crypto.getRandomValues(rand)
  let out = ''
  let acc = 0
  let bits = 0
  for (const b of rand) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) {
      out += CROCKFORD[(acc >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return ts + out
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return base64urlEncode(buf)
}

export function base64urlEncode(buf: Uint8Array): string {
  let s = ''
  for (const b of buf) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 恒定时间比较（比较 hash 时使用） */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
