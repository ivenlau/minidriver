import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../lib/env'
import { ulid, sha256Hex } from '../lib/ids'
import { serveR2Object, parseRange } from '../lib/r2'
import { validateNodeName } from '../lib/validate'
import { subtreeIds, subtreeContains, batchedIn, type NodeRow } from '../lib/nodes'

/**
 * WebDAV 挂载端点（/dav/*）：让网盘直接出现在系统文件管理器里。
 *
 * 认证：HTTP Basic，用户名任意，密码 = 设置页生成的 WebDAV 令牌（mdav_ 前缀，
 * 库内只存 SHA-256）。Basic 凭证随每个请求显式携带，不是环境凭证，故 CSRF 模型
 * 不适用（middleware.originCheck 对 /dav 豁免）。
 *
 * 方法映射：PROPFIND=列目录 · GET/HEAD=下载(Range) · PUT=上传/覆盖 · MKCOL=建目录 ·
 * DELETE=软删除进回收站 · MOVE=改名/移动 · COPY=单文件复制（目录不支持）·
 * LOCK/UNLOCK/PROPPATCH=假成功（兼容 Windows/Finder 的写前置探测）。
 *
 * 限额与平台约束：单请求体受 Cloudflare 上限（免费版 100MB），大文件上传仍走网页端分块。
 */

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024 // 与分块上传一致：10 GB
const QUOTA_BYTES = 10 * 1024 * 1024 * 1024 // 与前端设置页展示的配额一致
const LIST_LIMIT = 5000
const DAV_PREFIX = '/dav'
const LAST_USED_RENEW_MS = 24 * 3600 * 1000

export const dav = new Hono<AppEnv>()

// ---------------------------------------------------------------- 认证

function unauthorized(): Response {
  return new Response('401 Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="MiniDriver", charset="UTF-8"' },
  })
}

/** Basic 认证：用户名忽略，密码 = mdav_ 令牌；库内查 SHA-256（与会话同款单向哈希） */
dav.use('*', async (c, next) => {
  // OPTIONS 只做能力探测，不携带数据，免认证减少客户端握手摩擦
  if (c.req.method.toUpperCase() === 'OPTIONS') return next()
  const m = /^Basic\s+(.+)$/i.exec(c.req.header('authorization') ?? '')
  let token = ''
  if (m) {
    try {
      const decoded = atob(m[1]!.trim())
      token = decoded.slice(decoded.indexOf(':') + 1)
    } catch {
      // 非法 base64 → 401
    }
  }
  if (!token.startsWith('mdav_')) return unauthorized()
  const row = await c.env.DB.prepare(
    'SELECT id, last_used_at FROM webdav_tokens WHERE token_hash = ?',
  )
    .bind(await sha256Hex(token))
    .first<{ id: string; last_used_at: number | null }>()
  if (!row) return unauthorized()
  // 滑动更新 last_used_at（>24h 才写，避免每个请求落库）
  const now = Date.now()
  if (!row.last_used_at || now - row.last_used_at > LAST_USED_RENEW_MS) {
    await c.env.DB.prepare('UPDATE webdav_tokens SET last_used_at = ? WHERE id = ?').bind(now, row.id).run()
  }
  return next()
})

// ---------------------------------------------------------------- 路径解析

type Segments = string[]

type Resolved = {
  /** 完整路径对应的节点；null = 不存在（根目录也返回 null，用 isRoot 区分） */
  node: NodeRow | null
  /** 去掉最后一段后的父目录；目标在根下时为 null */
  parent: NodeRow | null
  /** 最后一段名字 */
  leafName: string | null
  /** 中间某段不存在或不是目录（整条路径不可达） */
  unreachable: boolean
}

/** /dav/a/b → ['a','b']；逐段百分号解码 + NFC 归一化（客户端可能发 NFD 形式） */
function davSegments(url: string): Segments | null {
  const pathname = new URL(url).pathname
  const rel = pathname.startsWith(`${DAV_PREFIX}/`) ? pathname.slice(DAV_PREFIX.length) : pathname === DAV_PREFIX ? '' : null
  if (rel === null) return null
  try {
    return rel
      .split('/')
      .filter(Boolean)
      .map((seg) => decodeURIComponent(seg).normalize('NFC'))
  } catch {
    return null // 非法百分号序列
  }
}

/** 单层查找：先按 NFC 查，未命中再按 NFD（Mac 浏览器上传的文件名可能以 NFD 存储） */
async function resolveChild(db: AppEnv['Bindings']['DB'], parentId: string | null, name: string): Promise<NodeRow | null> {
  const visible = `parent_id IS ? AND name = ? AND deleted_at IS NULL AND (type = 'folder' OR size IS NOT NULL)`
  const nfc = await db.prepare(`SELECT * FROM nodes WHERE ${visible}`).bind(parentId, name).first<NodeRow>()
  if (nfc) return nfc
  const nfd = name.normalize('NFD')
  if (nfd === name) return null
  return db.prepare(`SELECT * FROM nodes WHERE ${visible}`).bind(parentId, nfd).first<NodeRow>()
}

async function resolvePath(db: AppEnv['Bindings']['DB'], segs: Segments): Promise<Resolved> {
  const leafName = segs.length ? segs[segs.length - 1]! : null
  let parentId: string | null = null
  let parent: NodeRow | null = null
  for (let i = 0; i < segs.length - 1; i++) {
    const child = await resolveChild(db, parentId, segs[i]!)
    if (!child || child.type !== 'folder') return { node: null, parent, leafName, unreachable: true }
    parent = child
    parentId = child.id
  }
  const node = leafName ? await resolveChild(db, parentId, leafName) : null
  return { node, parent, leafName, unreachable: false }
}

/** 末段过文件名校验（空名/过长/'/'/./.. 拒绝），WebDAV 侧转成纯状态码 */
function validLeaf(name: string | null): name is string {
  if (name === null) return false
  try {
    validateNodeName(name)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- 方法分发

const ALLOW = 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY, LOCK, UNLOCK'

dav.all('*', async (c) => {
  const segs = davSegments(c.req.url)
  if (!segs) return xmlError(400, 'malformed-href')
  const method = c.req.method.toUpperCase()
  const db = c.env.DB
  const r = await resolvePath(db, segs)
  const isRoot = segs.length === 0

  switch (method) {
    case 'OPTIONS':
      return c.body(null, 200, { DAV: '1, 2', 'MS-Author-Via': 'DAV', Allow: ALLOW })
    case 'PROPFIND':
      return propfind(c, segs, r, isRoot)
    case 'GET':
    case 'HEAD':
      return davGet(c, r, isRoot)
    case 'PUT':
      return davPut(c, r, isRoot)
    case 'MKCOL':
      return davMkcol(c, segs, r, isRoot)
    case 'DELETE':
      return davDelete(c, r, isRoot)
    case 'MOVE':
    case 'COPY':
      return davMoveCopy(c, segs, r, method)
    case 'PROPPATCH':
      // 属性（Win32 文件属性等）不落库，假成功保住客户端写流程
      if (!isRoot && !r.node) return xmlError(404, 'not-found')
      return multistatus([
        propstatOk(hrefFor(segs, r.node?.type === 'folder' || isRoot), '<D:prop/>'),
      ])
    case 'LOCK':
      return davLock(c, segs, r, isRoot)
    case 'UNLOCK':
      return c.body(null, 204)
    default:
      return c.body(null, 405, { Allow: ALLOW })
  }
})

// ---------------------------------------------------------------- PROPFIND

async function propfind(c: Context<AppEnv>, segs: Segments, r: Resolved, isRoot: boolean): Promise<Response> {
  if (!isRoot && !r.node) return xmlError(404, 'not-found')

  const depth = (c.req.header('depth') ?? '0').trim().toLowerCase()
  if (depth === 'infinity') {
    // RFC 4918 允许拒绝无限深列举；主流客户端均用 0/1
    return xmlError(400, 'propfind-finite-depth')
  }

  // 目录响应携带容量配额（Windows/rclone 的剩余空间显示）；整次请求只聚合一次
  const used = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(size), 0) AS used FROM nodes WHERE type = 'file' AND deleted_at IS NULL",
  ).first<{ used: number }>()
  const quota = `<D:quota-used-bytes>${used?.used ?? 0}</D:quota-used-bytes>` +
    `<D:quota-available-bytes>${Math.max(0, QUOTA_BYTES - (used?.used ?? 0))}</D:quota-available-bytes>`

  const entries = [propResponse(segs, isRoot ? null : r.node, isRoot, quota)]
  if (depth === '1') {
    const parentId = isRoot ? null : r.node!.id
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM nodes WHERE parent_id IS ? AND deleted_at IS NULL AND (type = 'folder' OR size IS NOT NULL)
       ORDER BY name LIMIT ${LIST_LIMIT}`,
    )
      .bind(parentId)
      .all<NodeRow>()
    for (const child of results ?? []) {
      entries.push(propResponse([...segs, child.name], child, child.type === 'folder', quota))
    }
  }
  return multistatus(entries)
}

/** 单个 <D:response>；node 为 null 表示根目录（虚拟节点，仅存在于路径语义上） */
function propResponse(segs: Segments, node: NodeRow | null, isFolder: boolean, quota: string): string {
  const props: string[] = [
    `<D:displayname>${xmlEscape(node?.name ?? 'MiniDriver')}</D:displayname>`,
    `<D:creationdate>${new Date(node?.created_at ?? Date.now()).toISOString()}</D:creationdate>`,
    `<D:getlastmodified>${new Date(node?.updated_at ?? Date.now()).toUTCString()}</D:getlastmodified>`,
    `<D:resourcetype>${isFolder ? '<D:collection/>' : ''}</D:resourcetype>`,
    SUPPORTED_LOCK,
  ]
  if (!isFolder && node) {
    props.push(
      `<D:getcontentlength>${node.size ?? 0}</D:getcontentlength>`,
      `<D:getcontenttype>${xmlEscape(node.mime ?? 'application/octet-stream')}</D:getcontenttype>`,
      `<D:getetag>"${node.id}"</D:getetag>`,
    )
  } else {
    props.push(quota)
  }
  return propstatOk(hrefFor(segs, isFolder), `<D:prop>${props.join('')}</D:prop>`)
}

const SUPPORTED_LOCK =
  '<D:supportedlock><D:lockentry><D:lockscope><D:exclusive/></D:lockscope>' +
  '<D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock>'

function propstatOk(href: string, propXml: string): string {
  return `<D:response><D:href>${href}</D:href><D:propstat>${propXml}<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
}

// ---------------------------------------------------------------- GET / HEAD

async function davGet(c: Context<AppEnv>, r: Resolved, isRoot: boolean): Promise<Response> {
  if (isRoot || !r.node) return c.body(null, 404)
  if (r.node.type === 'folder' || !r.node.r2_key) return c.body(null, 405, { Allow: ALLOW })
  if (c.req.method.toUpperCase() === 'HEAD') {
    const obj = await c.env.R2.head(r.node.r2_key)
    if (!obj) return c.body(null, 404)
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': r.node.mime ?? 'application/octet-stream',
        'Content-Length': String(obj.size),
        ETag: obj.httpEtag,
        'Accept-Ranges': 'bytes',
        'Last-Modified': new Date(r.node.updated_at).toUTCString(),
      },
    })
  }
  const range = parseRange(c.req.header('range') ?? null, r.node.size ?? 0)
  const obj = await c.env.R2.get(r.node.r2_key, range ? { range } : undefined)
  if (!obj) return c.body(null, 404)
  return serveR2Object(obj, { name: r.node.name, mime: r.node.mime ?? '', disposition: 'inline' }, c.req.raw)
}

// ---------------------------------------------------------------- PUT

async function davPut(c: Context<AppEnv>, r: Resolved, isRoot: boolean): Promise<Response> {
  if (isRoot || !validLeaf(r.leafName)) return c.body(null, 400)
  if (r.unreachable) return c.body(null, 409) // 父目录缺失
  if (r.node?.type === 'folder') return c.body(null, 405, { Allow: ALLOW }) // 目录不可被 PUT 覆盖

  const lenHeader = c.req.header('content-length') ?? null
  const declared = lenHeader !== null ? Number.parseInt(lenHeader, 10) : NaN
  if (Number.isFinite(declared) && declared > MAX_FILE_SIZE) return c.body(null, 507)

  const mime = c.req.header('content-type')?.split(';')[0]!.trim() || r.node?.mime || 'application/octet-stream'
  const id = r.node?.id ?? ulid()
  const key = r.node?.r2_key ?? `f/${id}`
  const size = await writeR2FromRequest(c, key, mime, Number.isFinite(declared) ? declared : null)
  if (size < 0) return c.body(null, 507)

  const now = Date.now()
  if (r.node) {
    await c.env.DB.prepare('UPDATE nodes SET size = ?, mime = ?, updated_at = ? WHERE id = ?')
      .bind(size, mime, now, r.node.id)
      .run()
    return c.body(null, 204) // 覆盖已有资源
  }
  try {
    await c.env.DB.prepare(
      "INSERT INTO nodes (id, type, name, parent_id, size, mime, r2_key, created_at, updated_at) VALUES (?, 'file', ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(id, r.leafName, r.parent?.id ?? null, size, mime, key, now, now)
      .run()
  } catch {
    // 与网页端并发撞唯一索引（同级同名）：回收刚写入的 R2 对象
    await c.env.R2.delete(key)
    return c.body(null, 409)
  }
  return c.body(null, 201)
}

/** 请求体流式直通 R2（固定长度流）；无 Content-Length 的 chunked 请求回退整体缓冲。失败返回 -1 */
async function writeR2FromRequest(
  c: Context<AppEnv>,
  key: string,
  mime: string,
  declaredLength: number | null,
): Promise<number> {
  const meta = { httpMetadata: { contentType: mime } }
  try {
    if (declaredLength === 0) {
      await c.env.R2.put(key, new ArrayBuffer(0), meta)
      return 0
    }
    if (declaredLength !== null && c.req.raw.body) {
      const obj = await c.env.R2.put(key, c.req.raw.body, meta)
      return obj.size
    }
    const buf = await c.req.arrayBuffer()
    if (buf.byteLength > MAX_FILE_SIZE) return -1
    await c.env.R2.put(key, buf, meta)
    return buf.byteLength
  } catch {
    return -1
  }
}

// ---------------------------------------------------------------- MKCOL

async function davMkcol(c: Context<AppEnv>, segs: Segments, r: Resolved, isRoot: boolean): Promise<Response> {
  if (isRoot || !validLeaf(r.leafName)) return c.body(null, 400)
  if (r.node) return c.body(null, 405, { Allow: ALLOW }) // 已存在
  if (r.unreachable) return c.body(null, 409) // 父目录缺失
  try {
    await c.env.DB.prepare(
      "INSERT INTO nodes (id, type, name, parent_id, created_at, updated_at) VALUES (?, 'folder', ?, ?, ?, ?)",
    )
      .bind(ulid(), r.leafName, r.parent?.id ?? null, Date.now(), Date.now())
      .run()
  } catch {
    return c.body(null, 405) // 同级同名（唯一索引）
  }
  return c.body(null, 201)
}

// ---------------------------------------------------------------- DELETE

async function davDelete(c: Context<AppEnv>, r: Resolved, isRoot: boolean): Promise<Response> {
  if (isRoot) return c.body(null, 403) // 根目录不可删
  if (!r.node) return c.body(null, 404)
  // 软删除进回收站：与网页端同一语义，误删可在 30 天内恢复
  const ids = await subtreeIds(c.env.DB, r.node.id)
  await batchedIn(c.env.DB, (ph) => `UPDATE nodes SET deleted_at = ? WHERE id IN (${ph}) AND deleted_at IS NULL`, [Date.now()], ids)
  return c.body(null, 204)
}

// ---------------------------------------------------------------- MOVE / COPY

async function davMoveCopy(c: Context<AppEnv>, srcSegs: Segments, r: Resolved, method: 'MOVE' | 'COPY'): Promise<Response> {
  if (srcSegs.length === 0 || !r.node) return c.body(null, 404)
  if (method === 'COPY' && r.node.type === 'folder') return c.body(null, 502) // 目录复制涉及逐节点 R2 拷贝，易超子请求限额，明确拒绝

  // 解析 Destination（绝对 URL 或绝对路径），必须仍指向本服务 /dav 下
  const destRaw = c.req.header('destination')
  if (!destRaw) return c.body(null, 400)
  let destUrl: URL
  try {
    destUrl = new URL(destRaw, c.req.url)
  } catch {
    return c.body(null, 400)
  }
  if (destUrl.host !== new URL(c.req.url).host) return c.body(null, 502)
  const destSegs = davSegments(destUrl.href)
  if (!destSegs || destSegs.length === 0 || !validLeaf(destSegs[destSegs.length - 1] ?? null)) {
    return c.body(null, 400)
  }
  if (srcSegs.length === destSegs.length && srcSegs.every((s, i) => s === destSegs[i])) {
    return c.body(null, 403) // 源 = 目标
  }

  const overwrite = (c.req.header('overwrite') ?? 'T').trim().toUpperCase() !== 'F'
  const dest = await resolvePath(c.env.DB, destSegs)
  if (dest.unreachable) return c.body(null, 409) // 目标父目录缺失
  const destParentId = destSegs.length === 1 ? null : dest.parent?.id ?? null
  const destName = destSegs[destSegs.length - 1]!

  if (dest.node) {
    if (!overwrite) return c.body(null, 412) // Overwrite: F 且目标已存在
    if (dest.node.type === 'folder') return c.body(null, 409) // 目录不可被覆盖
    if (dest.node.id === r.node.id) return c.body(null, 403) // 覆盖自身
  }
  if (
    method === 'MOVE' && r.node.type === 'folder' && destParentId &&
    (await subtreeContains(c.env.DB, r.node.id, destParentId))
  ) {
    return c.body(null, 409) // 移动进自身子树（与网页端防环一致）
  }

  if (method === 'MOVE') {
    if (dest.node) await hardDeleteSingle(c.env, dest.node) // 覆盖：先移走原文件
    try {
      await c.env.DB.prepare('UPDATE nodes SET parent_id = ?, name = ?, updated_at = ? WHERE id = ?')
        .bind(destParentId, destName, Date.now(), r.node.id)
        .run()
    } catch {
      return c.body(null, 409)
    }
    return c.body(null, dest.node ? 204 : 201)
  }

  // COPY（仅文件）：R2 对象复制 + 新节点；缩略图不共享（避免硬删除时误删共享对象）
  if (dest.node) await hardDeleteSingle(c.env, dest.node)
  const newId = ulid()
  const newKey = `f/${newId}`
  try {
    // R2 get→put 流式直通复制（body 为固定长度流，可直传 put）；CPU 占用≈0
    const src = await c.env.R2.get(r.node.r2_key!)
    if (!src) return c.body(null, 404)
    await c.env.R2.put(newKey, src.body, { httpMetadata: src.httpMetadata })
  } catch {
    return c.body(null, 500)
  }
  try {
    await c.env.DB.prepare(
      "INSERT INTO nodes (id, type, name, parent_id, size, mime, r2_key, created_at, updated_at) VALUES (?, 'file', ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(newId, destName, destParentId, r.node.size, r.node.mime, newKey, Date.now(), Date.now())
      .run()
  } catch {
    await c.env.R2.delete(newKey)
    return c.body(null, 409)
  }
  return c.body(null, dest.node ? 204 : 201)
}

/** 覆盖目标：删 R2 内容 + 缩略图 + 行（目标是文件，无子树） */
async function hardDeleteSingle(env: AppEnv['Bindings'], node: NodeRow): Promise<void> {
  const keys = [node.r2_key, node.thumb_key].filter((k): k is string => !!k)
  if (keys.length) await env.R2.delete(keys)
  await env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(node.id).run()
}

// ---------------------------------------------------------------- LOCK

async function davLock(c: Context<AppEnv>, segs: Segments, r: Resolved, isRoot: boolean): Promise<Response> {
  if (!isRoot && !r.node) return c.body(null, 404)
  const token = `urn:uuid:${crypto.randomUUID()}`
  const body =
    `<?xml version="1.0" encoding="utf-8"?>\n<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>` +
    `<D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>0</D:depth>` +
    `<D:timeout>Second-3600</D:timeout><D:locktoken><D:href>${token}</D:href></D:locktoken>` +
    `<D:lockroot><D:href>${hrefFor(segs, r.node?.type === 'folder' || isRoot)}</D:href></D:lockroot>` +
    `</D:activelock></D:lockdiscovery></D:prop>`
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Lock-Token': `<${token}>` },
  })
}

// ---------------------------------------------------------------- XML 工具

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!)
}

function hrefFor(segs: Segments, isFolder: boolean): string {
  const path = segs.map((s) => encodeURIComponent(s)).join('/')
  return `${DAV_PREFIX}/${path}${isFolder && path ? '/' : ''}`
}

function multistatus(responses: string[]): Response {
  return new Response(
    `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">${responses.join('')}</D:multistatus>`,
    { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  )
}

function xmlError(status: number, condition: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="utf-8"?>\n<D:error xmlns:D="DAV:"><D:${condition}/></D:error>`,
    { status, headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  )
}
