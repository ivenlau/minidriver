import { Errors } from './errors'

/** 文件/目录名校验：去首尾空白，拒绝空、过长、路径分隔符与特殊项 */
export function validateNodeName(input: unknown): string {
  if (typeof input !== 'string') throw Errors.badRequest('NAME_INVALID')
  const name = input.trim()
  if (!name || name.length > 255) throw Errors.badRequest('NAME_INVALID')
  if (name.includes('/') || name.includes('\0')) throw Errors.badRequest('NAME_INVALID')
  if (name === '.' || name === '..') throw Errors.badRequest('NAME_INVALID')
  return name
}

export function readString(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key]
  return typeof v === 'string' ? v : undefined
}

export async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
    throw new Error('not object')
  } catch {
    throw Errors.badRequest('BAD_JSON')
  }
}
