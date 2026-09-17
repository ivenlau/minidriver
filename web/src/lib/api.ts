/** API 封装：统一错误码 + CSRF 头 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code)
  }
}

async function handle(res: Response): Promise<unknown> {
  if (res.ok) {
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) return res.json()
    return null
  }
  let code = res.status >= 500 ? 'INTERNAL' : 'REQUEST_FAILED'
  try {
    const body = (await res.json()) as { error?: { code?: string } }
    code = body?.error?.code ?? code
  } catch {
    /* 非 JSON 错误体 */
  }
  throw new ApiError(res.status, code)
}

async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      'x-minidriver': '1',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return handle(res)
}

async function rawBody(method: string, path: string, body: Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>): Promise<unknown> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'x-minidriver': '1' },
    body,
  })
  return handle(res)
}

export const api = {
  get: <T>(path: string) => request('GET', path) as Promise<T>,
  post: <T>(path: string, body?: unknown) => request('POST', path, body) as Promise<T>,
  put: <T>(path: string, body?: unknown) => request('PUT', path, body) as Promise<T>,
  patch: <T>(path: string, body?: unknown) => request('PATCH', path, body) as Promise<T>,
  del: <T>(path: string, body?: unknown) => request('DELETE', path, body) as Promise<T>,
  send: <T>(method: 'PUT' | 'POST', path: string, body: Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>) =>
    rawBody(method, path, body) as Promise<T>,
}

/** 带 Range 的文本预览（前 1MB） */
export async function fetchTextPreview(nodeId: string): Promise<string> {
  const res = await fetch(`/api/nodes/${nodeId}/content`, {
    headers: { range: 'bytes=0-1048575' },
    credentials: 'same-origin',
  })
  if (!res.ok && res.status !== 206) throw new ApiError(res.status, 'REQUEST_FAILED')
  return res.text()
}
