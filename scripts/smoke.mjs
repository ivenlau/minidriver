/**
 * MiniDriver API 冒烟测试（无需浏览器）：
 * 用 Node WebCrypto 伪造一个 ES256 WebAuthn 认证器，
 * 走完 setup → 登录 → 目录/文件 → 分块上传 → 下载/Range → 缩略图 →
 * 分享（密码/公开访问/吊销）→ 回收站 → 搜索 → 密码+TOTP 登录 全链路。
 *
 * 运行：npm run smoke（需先 npm run dev:api 并应用本地迁移）
 */

import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:8787'
const SETUP_TOKEN = process.env.SMOKE_SETUP_TOKEN ?? 'dev-setup-token'

/**
 * RP ID / Origin 解析：
 * 1) 显式环境变量 SMOKE_RP_ID / SMOKE_ORIGIN 优先
 * 2) 否则读取 .dev.vars：配置了 APP_PUBLIC_URL 就对齐它（npm run smoke 开箱即用）
 * 3) 都没有（零配置/CI）→ 与 BASE 同源（服务端回退到请求来源）
 */
function readDevVars() {
  try {
    return Object.fromEntries(
      readFileSync('.dev.vars', 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    )
  } catch {
    return {}
  }
}

let RP_ID = process.env.SMOKE_RP_ID ?? new URL(BASE).hostname
let ORIGIN = process.env.SMOKE_ORIGIN ?? new URL(BASE).origin
{
  const dv = readDevVars()
  const configured = dv.APP_PUBLIC_URL && !dv.APP_PUBLIC_URL.includes('<your-subdomain>')
  if (!process.env.SMOKE_RP_ID && configured) {
    RP_ID = new URL(dv.APP_PUBLIC_URL).hostname
    const allowed = (dv.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    ORIGIN = process.env.SMOKE_ORIGIN ?? allowed.find((o) => new URL(o).hostname === RP_ID) ?? dv.APP_PUBLIC_URL
  }
}

let passed = 0
let failed = 0
function check(name, cond, extra = '') {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name} ${extra}`)
  }
}

// ---------------------------------------------------------------- 极简 Cookie jar

class Jar {
  cookies = new Map()
  absorb(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';')
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      const name = pair.slice(0, eq).trim()
      if (/expires=Thu, 01 Jan 1970/i.test(line) || /max-age=0/i.test(line)) {
        this.cookies.delete(name)
      } else {
        this.cookies.set(name, pair.slice(eq + 1).trim())
      }
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

const jar = new Jar()

async function call(method, path, { body, raw, origin, csrfHeader = true, cookie = true } = {}) {
  const headers = {}
  if (method !== 'GET' && method !== 'HEAD') {
    if (csrfHeader) headers['x-minidriver'] = '1'
    if (origin) headers.origin = origin
    if (body !== undefined && !raw) headers['content-type'] = 'application/json'
  }
  if (cookie && jar.header()) headers.cookie = jar.header()
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })
  jar.absorb(res)
  let json = null
  try {
    json = await res.json()
  } catch {
    /* 非 JSON（文件流等） */
  }
  return { res, json }
}

// ---------------------------------------------------------------- 伪造认证器

const subtle = crypto.subtle

function b64u(buf) {
  return Buffer.from(buf).toString('base64url')
}
function u8(buf) {
  return new Uint8Array(buf)
}
async function sha256(data) {
  return u8(await subtle.digest('SHA-256', data))
}

function cborHead(major, val) {
  if (val < 24) return new Uint8Array([(major << 5) | val])
  if (val < 256) return new Uint8Array([(major << 5) | 24, val])
  if (val < 65536) return new Uint8Array([(major << 5) | 25, val >> 8, val & 0xff])
  return new Uint8Array([(major << 5) | 26, val >>> 24, (val >>> 16) & 0xff, (val >>> 8) & 0xff, val & 0xff])
}

function cborEncode(value) {
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value)
    const head = cborHead(3, bytes.length)
    return concat([head, bytes])
  }
  if (typeof value === 'number') {
    if (value >= 0) return cborHead(0, value)
    return cborHead(1, -value - 1)
  }
  if (value instanceof Uint8Array) {
    const out = new Uint8Array(8 + value.length)
    const head = cborHead(2, value.length)
    out.set(head, 0)
    out.set(value, head.length)
    return out.slice(0, head.length + value.length)
  }
  if (Array.isArray(value)) {
    const parts = [cborHead(4, value.length)]
    for (const item of value) parts.push(cborEncode(item))
    return concat(parts)
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    const parts = [cborHead(5, entries.length)]
    for (const [k, v] of entries) {
      // COSE 用整数键，attestationObject 用文本键
      const num = Number(k)
      parts.push(Number.isFinite(num) && String(num) === k ? cborEncode(num) : cborEncode(k))
      parts.push(cborEncode(v))
    }
    return concat(parts)
  }
  throw new Error('cbor: unsupported')
}

function randomBytes(len) {
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i += 65536) {
    crypto.getRandomValues(out.subarray(i, Math.min(i + 65536, len)))
  }
  return out
}

function concat(parts) {
  const len = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(len)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

/** 伪造的 ES256 认证器 */
class FakeAuthenticator {
  constructor() {
    this.counter = 0
  }
  async makeCredential(rpId) {
    this.kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const pub = u8(await subtle.exportKey('raw', this.kp.publicKey))
    const x = pub.slice(1, 33)
    const y = pub.slice(33, 65)
    this.credentialId = randomBytes(32)

    const coseKey = cborEncode({ 1: 2, 3: -7, '-1': 1, '-2': x, '-3': y })
    const authData = concat([
      await sha256(new TextEncoder().encode(rpId)),
      new Uint8Array([0x41]), // UP | AT
      new Uint8Array(4), // signCount
      new Uint8Array(16), // aaguid
      new Uint8Array([0, this.credentialId.length]),
      this.credentialId,
      coseKey,
    ])
    return { fmt: 'none', attStmt: {}, authData }
  }

  async assert(rpId) {
    this.counter++
    const counterBytes = new Uint8Array(4)
    new DataView(counterBytes.buffer).setUint32(0, this.counter)
    const authData = concat([await sha256(new TextEncoder().encode(rpId)), new Uint8Array([0x05]), counterBytes])
    return authData
  }

  async sign(authData, clientDataJSON) {
    const clientHash = await sha256(new TextEncoder().encode(clientDataJSON))
    const sigRaw = u8(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.kp.privateKey, concat([authData, clientHash])))
    return rawToDer(sigRaw)
  }
}

function rawToDer(raw) {
  const half = raw.length / 2
  let r = raw.slice(0, half)
  let s = raw.slice(half)
  const trim = (arr) => {
    let i = 0
    while (i < arr.length - 1 && arr[i] === 0) i++
    let v = arr.slice(i)
    if (v[0] & 0x80) v = new Uint8Array([0, ...v])
    return v
  }
  r = trim(r)
  s = trim(s)
  return new Uint8Array([0x30, r.length + s.length + 4, 0x02, r.length, ...r, 0x02, s.length, ...s])
}

const authr = new FakeAuthenticator()

function registrationResponse(attestationObject, challenge) {
  const clientDataJSON = JSON.stringify({ type: 'webauthn.create', challenge, origin: ORIGIN })
  return {
    id: b64u(authr.credentialId),
    rawId: b64u(authr.credentialId),
    type: 'public-key',
    response: {
      clientDataJSON: b64u(new TextEncoder().encode(clientDataJSON)),
      attestationObject: b64u(cborEncode(attestationObject)),
      transports: ['internal'],
      clientExtensionResults: {},
    },
    clientExtensionResults: {},
    authenticatorAttachment: 'platform',
  }
}

async function assertionResponse(challenge) {
  const clientDataJSON = JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN })
  const authData = await authr.assert(RP_ID)
  const signature = await authr.sign(authData, clientDataJSON)
  return {
    id: b64u(authr.credentialId),
    rawId: b64u(authr.credentialId),
    type: 'public-key',
    response: {
      clientDataJSON: b64u(new TextEncoder().encode(clientDataJSON)),
      authenticatorData: b64u(authData),
      signature: b64u(signature),
      userHandle: null,
    },
    clientExtensionResults: {},
  }
}

// ---------------------------------------------------------------- 测试

async function main() {
  console.log(`\n▶ MiniDriver API 冒烟测试 @ ${BASE}\n`)

  // 健康检查 / 初始状态
  {
    const { res, json } = await call('GET', '/api/health')
    check('health 200', res.status === 200 && json?.ok === true)
    const boot = await call('GET', '/api/bootstrap')
    check('bootstrap: 未初始化', boot.json?.initialized === false)
  }

  // 鉴权边界
  {
    const noAuth = await call('GET', '/api/nodes')
    check('未登录访问列表 → 401', noAuth.res.status === 401)
    const noCsrf = await call('POST', '/api/folders', { body: { name: 'x' }, csrfHeader: false, origin: ORIGIN })
    check('缺 CSRF 头 → 403', noCsrf.res.status === 403)
    const badOrigin = await call('POST', '/api/folders', { body: { name: 'x' }, origin: 'https://evil.example' })
    check('伪造 Origin → 403', badOrigin.res.status === 403)
  }

  // Setup：注册第一个 Passkey
  let recoveryCodes = []
  {
    const opt = await call('GET', `/api/auth/webauthn/setup/options?email=owner@minidriver.test`)
    check('setup options 下发 challenge', typeof opt.json?.challenge === 'string')
    const bad = await call('POST', '/api/setup', {
      body: { setupToken: 'wrong', credential: registrationResponse(await authr.makeCredential(RP_ID), opt.json.challenge) },
    })
    check('错误初始化口令 → 403', bad.res.status === 403)

    const att = await authr.makeCredential(RP_ID)
    const setup = await call('POST', '/api/setup', {
      body: {
        setupToken: SETUP_TOKEN,
        email: 'owner@minidriver.test',
        displayName: 'Owner',
        name: 'Smoke key',
        credential: registrationResponse(att, opt.json.challenge),
      },
    })
    check('初始化成功', setup.res.status === 200, JSON.stringify(setup.json))
    recoveryCodes = setup.json?.recoveryCodes ?? []
    check('返回 10 个恢复码', recoveryCodes.length === 10)

    const again = await call('GET', '/api/auth/webauthn/setup/options')
    check('初始化完成后关闭 setup', again.res.status === 403)

    const me = await call('GET', '/api/auth/me')
    check('当前用户信息', me.json?.displayName === 'Owner' && me.json?.passkeyCount === 1)
  }

  // 目录 + 小文件快速通道
  let folderId, helloId
  {
    const mk = await call('POST', '/api/folders', { body: { name: '文档' } })
    check('新建文件夹', mk.res.status === 201 && mk.json?.id)
    folderId = mk.json.id

    const dup = await call('POST', '/api/folders', { body: { name: '文档' } })
    check('同级重名 → 409 NAME_CONFLICT', dup.res.status === 409 && dup.json?.error?.code === 'NAME_CONFLICT')

    const fast = await call('POST', `/api/files/fast?name=${encodeURIComponent('hello.txt')}&parentId=${folderId}&mime=text/plain`, {
      raw: true,
      body: new TextEncoder().encode('hello world'),
    })
    check('快速通道上传 hello.txt', fast.res.status === 201 && fast.json?.size === 11, JSON.stringify(fast.json))
    helloId = fast.json?.id

    const list = await call('GET', `/api/nodes?parent=${folderId}`)
    check('目录列表包含 hello.txt', list.json?.items?.some((n) => n.id === helloId))
    const root = await call('GET', '/api/nodes?parent=root')
    check('根目录包含文件夹（文件夹置前由前端排序）', root.json?.items?.some((n) => n.id === folderId))
  }

  // 分块上传（8MiB + 4MiB）
  let bigId
  {
    const chunkA = randomBytes(8 * 1024 * 1024)
    const chunkB = randomBytes(4 * 1024 * 1024)
    const total = chunkA.length + chunkB.length

    const init = await call('POST', '/api/files/init', {
      body: { name: 'big.bin', parentId: null, size: total, mime: 'application/octet-stream' },
    })
    check('init 建立分块上传', init.res.status === 201 && init.json?.fileId)
    bigId = init.json?.fileId

    const hidden = await call('GET', '/api/nodes?parent=root')
    check('未完成上传对列表隐藏', !hidden.json?.items?.some((n) => n.id === bigId))

    const p1 = await call('PUT', `/api/files/${bigId}/parts/1`, { raw: true, body: chunkA })
    const p2 = await call('PUT', `/api/files/${bigId}/parts/2`, { raw: true, body: chunkB })
    check('分块 1 上传返回 etag', !!p1.json?.etag)
    check('分块 2 上传返回 etag', !!p2.json?.etag)

    const complete = await call('POST', `/api/files/${bigId}/complete`, {
      body: { parts: [p1.json, p2.json] },
    })
    check('complete 后大小正确', complete.json?.size === total, JSON.stringify(complete.json))

    // 下载比对 + Range
    const dl = await fetch(`${BASE}/api/nodes/${bigId}/content`, { headers: { cookie: jar.header() } })
    const buf = new Uint8Array(await dl.arrayBuffer())
    check('整文件下载内容一致', dl.status === 200 && buf.length === total && buf[0] === chunkA[0] && buf[buf.length - 1] === chunkB[chunkB.length - 1])
    check('下载头支持 Range', dl.headers.get('accept-ranges') === 'bytes')

    const range = await fetch(`${BASE}/api/nodes/${bigId}/content`, {
      headers: { cookie: jar.header(), range: 'bytes=0-99' },
    })
    const rbuf = new Uint8Array(await range.arrayBuffer())
    check(
      'Range 请求 → 206 + 正确切片',
      range.status === 206 && rbuf.length === 100 && rbuf[5] === chunkA[5],
      `status=${range.status} len=${rbuf.length} b5=${rbuf[5]} want=${chunkA[5]}`,
    )
    check('Content-Range 头正确', range.headers.get('content-range') === `bytes 0-99/${total}`)
  }

  // 缩略图
  {
    const fakeWebp = new Uint8Array([0x52, 0x49, 0x46, 0x46, ...randomBytes(64)])
    const put = await call('PUT', `/api/files/${helloId}/thumb`, { raw: true, body: fakeWebp })
    check('上传缩略图', put.res.status === 200)
    const get = await fetch(`${BASE}/api/nodes/${helloId}/thumb`, { headers: { cookie: jar.header() } })
    check('读取缩略图', get.status === 200 && get.headers.get('content-type') === 'image/webp')
    const list = await call('GET', `/api/nodes?parent=${folderId}`)
    check('列表带 hasThumb 标记', list.json?.items?.find((n) => n.id === helloId)?.hasThumb === true)
  }

  // 星标 / 搜索 / 存储
  {
    await call('PATCH', `/api/nodes/${helloId}`, { body: { starred: true } })
    const starred = await call('GET', '/api/starred')
    check('星标列表', starred.json?.items?.some((n) => n.id === helloId))

    const search = await call('GET', '/api/search?q=hello')
    check('搜索命中', search.json?.items?.some((n) => n.id === helloId))

    const storage = await call('GET', '/api/storage')
    const expected = 11 + 12 * 1024 * 1024
    check('存储统计正确', storage.json?.used === expected, `got ${storage.json?.used}, want ${expected}`)
  }

  // 分享：密码 + 公开访问 + 吊销
  let shareUrl, shareToken
  {
    const badExp = await call('POST', '/api/shares', { body: { nodeId: helloId, expiresIn: 5 } })
    check('非法有效期 → 400', badExp.res.status === 400)

    const created = await call('POST', '/api/shares', {
      body: { nodeId: helloId, expiresIn: 3600, password: 'p@ssw0rd', maxDownloads: 10 },
    })
    check('创建分享', created.res.status === 201 && !!created.json?.url)
    shareUrl = created.json?.url
    shareToken = shareUrl?.split('/s/')[1]

    const metaLocked = await fetch(`${BASE}/api/s/${shareToken}/meta`)
    const metaLockedJson = await metaLocked.json()
    check('带密码分享 meta → needPassword', metaLockedJson?.needPassword === true)

    const wrong = await call('POST', `/api/s/${shareToken}/unlock`, { body: { password: 'nope' }, cookie: false })
    check('错误密码 → 401', wrong.res.status === 401 && wrong.json?.error?.code === 'SHARE_PASSWORD_INVALID')

    const right = await call('POST', `/api/s/${shareToken}/unlock`, { body: { password: 'p@ssw0rd' }, cookie: false })
    check('正确密码解锁', right.res.status === 200 && right.json?.meta?.name === 'hello.txt')
    check('解锁写入 __Host-sh Cookie', [...jar.cookies.keys()].some((k) => k.startsWith('__Host-sh')))

    const dlRes = await fetch(`${BASE}/api/s/${shareToken}/content?dl=1`, { headers: { cookie: jar.header() } })
    check('访客凭解锁 Cookie 下载', dlRes.status === 200 && dlRes.headers.get('content-disposition').includes('attachment'))

    const shares = await call('GET', '/api/shares')
    const row = shares.json?.items?.find((s) => s.nodeId === helloId)
    check('分享列表计数 +1', row?.downloadCount === 1, JSON.stringify(row))

    await call('DELETE', `/api/shares/${row?.id}`)
    const after = await fetch(`${BASE}/api/s/${shareToken}/meta`)
    check('吊销后访客访问 → 404', after.status === 404)

    // 回归：purge 彻底删除记录（分享管理里的「删除记录」）
    const purgeShare = await call('POST', '/api/shares', { body: { nodeId: helloId, expiresIn: 3600 } })
    const purged = await call('DELETE', `/api/shares/${purgeShare.json?.id}?purge=1`)
    check('purge 删除成功', purged.res.status === 200 && purged.json?.purged === true)
    const listAfterPurge = await call('GET', '/api/shares')
    check('purge 后记录从列表消失', !listAfterPurge.json?.items?.some((s) => s.id === purgeShare.json?.id))
  }

  // 无密码分享 + 过期检查
  {
    const created = await call('POST', '/api/shares', { body: { nodeId: helloId, expiresIn: 1 } })
    await new Promise((r) => setTimeout(r, 1200))
    const res = await fetch(`${BASE}/api/s/${created.json?.url?.split('/s/')[1]}/meta`)
    check('过期分享 → 404', res.status === 404)
  }

  // 回收站
  {
    const del = await call('DELETE', `/api/nodes/${helloId}`)
    check('软删除进回收站', del.res.status === 200)
    const trash = await call('GET', '/api/trash')
    check('回收站可见', trash.json?.items?.some((n) => n.id === helloId))
    const gone = await call('GET', `/api/nodes?parent=${folderId}`)
    check('原目录不可见', !gone.json?.items?.some((n) => n.id === helloId))

    const restore = await call('POST', `/api/nodes/${helloId}/restore`)
    check('恢复', restore.res.status === 200)
    const back = await call('GET', `/api/nodes?parent=${folderId}`)
    check('恢复后回到原目录', back.json?.items?.some((n) => n.id === helloId))
  }

  // 移动 + 防环
  {
    const sub = await call('POST', '/api/folders', { body: { name: '子目录', parentId: folderId } })
    const cycle = await call('PATCH', `/api/nodes/${folderId}`, { body: { parentId: sub.json?.id } })
    check(
      '移动进自身子树 → 400 CYCLE_FORBIDDEN',
      cycle.res.status === 400 && cycle.json?.error?.code === 'CYCLE_FORBIDDEN',
      `status=${cycle.res.status} ${JSON.stringify(cycle.json)}`,
    )
  }

  // 登出 + Passkey 重新登录
  {
    const out = await call('POST', '/api/auth/logout')
    const meAfter = await call('GET', '/api/auth/me')
    check('登出后 → 401', meAfter.res.status === 401, `logout=${out.res.status} me=${meAfter.res.status} jar=${jar.header()}`)

    const opt = await call('GET', '/api/auth/webauthn/login/options')
    check('登录挑战（discoverable）', typeof opt.json?.challenge === 'string' && !opt.json?.allowCredentials?.length)
    const assertion = await assertionResponse(opt.json.challenge)
    const login = await call('POST', '/api/auth/webauthn/login', { body: { credential: assertion } })
    check('Passkey 登录成功', login.res.status === 200, JSON.stringify(login.json))
    const me = await call('GET', '/api/auth/me')
    check('会话可用', me.json?.displayName === 'Owner')

    // 回归：添加第二个 Passkey 的 INSERT 必须真正落库（历史上静默丢过 .run()）
    const regOpt = await call('GET', '/api/auth/webauthn/register/options')
    check('注册选项（需登录）', typeof regOpt.json?.challenge === 'string')
    const att2 = await authr.makeCredential(RP_ID)
    const reg = await call('POST', '/api/auth/webauthn/register', {
      body: { credential: registrationResponse(att2, regOpt.json.challenge), name: 'Second key' },
    })
    check('添加第二个 Passkey', reg.res.status === 200, JSON.stringify(reg.json))
    const dupReg = await call('POST', '/api/auth/webauthn/register', {
      body: { credential: registrationResponse(att2, regOpt.json.challenge), name: 'Dup key' },
    })
    check('重复注册同一凭证 → 409', dupReg.res.status === 409 && dupReg.json?.error?.code === 'CREDENTIAL_EXISTS', JSON.stringify(dupReg.json))
    const credList = await call('GET', '/api/auth/credentials')
    check('Passkey 列表包含新凭证', credList.json?.credentials?.length === 2 && credList.json?.credentials?.some((x) => x.name === 'Second key'), JSON.stringify(credList.json))
  }

  // 密码 + TOTP
  {
    const pw = await call('PUT', '/api/auth/password', { body: { newPassword: 'testpass123' } })
    check('设置密码', pw.res.status === 200)

    const wrongPw = await call('POST', '/api/auth/password/login', { body: { password: 'wrong-pass' } })
    check('错误密码 → 401', wrongPw.res.status === 401)

    const totpSetup = await call('POST', '/api/auth/totp/setup')
    check('TOTP 密钥下发', typeof totpSetup.json?.secret === 'string' && totpSetup.json?.otpauthUri?.startsWith('otpauth://totp/'))
    const code = computeTotp(totpSetup.json.secret)
    const confirm = await call('POST', '/api/auth/totp/confirm', { body: { code } })
    check('TOTP 启用', confirm.res.status === 200)

    const step1 = await call('POST', '/api/auth/password/login', { body: { password: 'testpass123' } })
    check('密码登录 → 需要 TOTP', step1.json?.needTotp === true, JSON.stringify(step1.json))

    await call('POST', '/api/auth/logout')
    await call('POST', '/api/auth/password/login', { body: { password: 'testpass123' } })
    const code2 = computeTotp(totpSetup.json.secret, Date.now() + 31000)
    const verify = await call('POST', '/api/auth/totp/verify', { body: { code: code2 } })
    check('TOTP 验证登录', verify.res.status === 200, JSON.stringify(verify.json))

    // 恢复码
    await call('POST', '/api/auth/logout')
    const rec = await call('POST', '/api/auth/recover', { body: { code: recoveryCodes[0] } })
    check('恢复码登录', rec.res.status === 200, JSON.stringify(rec.json))
    const reuse = await call('POST', '/api/auth/recover', { body: { code: recoveryCodes[0] }, cookie: false })
    check('恢复码一次性', reuse.res.status === 401)
  }

  // 会话管理
  {
    const sessions = await call('GET', '/api/auth/sessions')
    check('设备列表含当前会话', (sessions.json?.sessions ?? []).some((s) => s.isCurrent))
  }

  console.log(`\n结果：${passed} 通过，${failed} 失败\n`)
  process.exit(failed > 0 ? 1 : 0)
}

/** RFC 6238 TOTP（HMAC-SHA1，独立实现用于交叉验证服务端） */
function computeTotp(secretB32, atMs = Date.now()) {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = secretB32.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let acc = 0
  let bits = 0
  const bytes = []
  for (const ch of clean) {
    acc = (acc << 5) | B32.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((acc >>> bits) & 0xff)
    }
  }
  const key = Buffer.from(bytes)
  const counter = Math.floor(atMs / 1000 / 30)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const mac = createHmac('sha1', key).update(msg).digest()
  const off = mac[mac.length - 1] & 0x0f
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]
  return String(bin % 1_000_000).padStart(6, '0')
}

main().catch((err) => {
  console.error('测试崩溃：', err)
  process.exit(1)
})
