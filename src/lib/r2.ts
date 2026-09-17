/** 解析 Range 头为 R2 range 选项；格式非法时返回 null（按 200 全量返回） */
export function parseRange(header: string | null | undefined, size: number): { offset: number; length: number } | null {
  if (!header || size <= 0) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, startStr, endStr] = m
  if (startStr === '' && endStr === '') return null
  if (startStr === '') {
    // bytes=-N：最后 N 字节
    const suffix = Math.min(parseInt(endStr!, 10), size)
    if (suffix <= 0) return null
    return { offset: size - suffix, length: suffix }
  }
  const start = parseInt(startStr!, 10)
  if (start >= size) return null
  const end = endStr === '' ? size - 1 : Math.min(parseInt(endStr as string, 10), size - 1)
  if (end < start) return null
  return { offset: start, length: end - start + 1 }
}

export type ServeOptions = {
  name: string
  mime: string
  disposition?: 'attachment' | 'inline'
}

/** 将 R2 对象以支持 Range / ETag / 304 的方式流式回传 */
export function serveR2Object(obj: R2ObjectBody, opts: ServeOptions, req: Request): Response {
  const range = parseRange(req.headers.get('range'), obj.size)

  const inm = req.headers.get('if-none-match')
  if (inm && obj.httpEtag && inm.split(',').map((s) => s.trim()).includes(obj.httpEtag)) {
    return new Response(null, { status: 304, headers: { ETag: obj.httpEtag, 'Accept-Ranges': 'bytes' } })
  }

  const base = baseHeaders(opts)
  if (range) {
    return new Response(obj.body, {
      status: 206,
      headers: {
        ...base,
        'Content-Range': `bytes ${range.offset}-${range.offset + range.length - 1}/${obj.size}`,
        'Content-Length': String(range.length),
        ETag: obj.httpEtag,
        'Accept-Ranges': 'bytes',
      },
    })
  }
  return new Response(obj.body, {
    status: 200,
    headers: { ...base, 'Content-Length': String(obj.size), ETag: obj.httpEtag, 'Accept-Ranges': 'bytes' },
  })
}

function baseHeaders(opts: ServeOptions): Record<string, string> {
  const asciiFallback = opts.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'")
  return {
    'Content-Type': opts.mime || 'application/octet-stream',
    'Content-Disposition': `${opts.disposition ?? 'inline'}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(opts.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=0, must-revalidate',
  }
}
