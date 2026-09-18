import { Hono } from 'hono'
import type { AppEnv } from '../lib/env'
import { Errors } from '../lib/errors'
import { parseRange } from '../lib/r2'

/**
 * 图床公开直链：GET /i/:slug
 * 无鉴权（天生公开）、public 长缓存（热链基本不打 Worker）、CORS 全开、
 * 支持 Range 与 ETag/304。软删除（回收站）仍可访问，彻底删除后行消失自然 404。
 */
export const imageLink = new Hono<AppEnv>()

imageLink.get('/i/:slug', async (c) => {
  const node = await c.env.DB.prepare(
    'SELECT r2_key, mime, size, name FROM nodes WHERE public_slug = ?',
  )
    .bind(c.req.param('slug'))
    .first<{ r2_key: string; mime: string | null; size: number; name: string }>()
  if (!node || !node.r2_key) throw Errors.notFound()

  const range = parseRange(c.req.header('range'), node.size)
  const obj = await c.env.R2.get(node.r2_key, range ? { range } : undefined)
  if (!obj) throw Errors.notFound()

  const headers: Record<string, string> = {
    'Content-Type': node.mime || 'application/octet-stream',
    'Cache-Control': 'public, max-age=86400',
    'Access-Control-Allow-Origin': '*',
    ETag: obj.httpEtag,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(node.name)}`,
  }

  if (c.req.header('if-none-match')?.split(',').map((s) => s.trim()).includes(obj.httpEtag)) {
    return new Response(null, { status: 304, headers })
  }
  if (range) {
    return new Response(obj.body, {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${range.offset}-${range.offset + range.length - 1}/${node.size}`,
        'Content-Length': String(range.length),
      },
    })
  }
  return new Response(obj.body, { status: 200, headers: { ...headers, 'Content-Length': String(node.size) } })
})
