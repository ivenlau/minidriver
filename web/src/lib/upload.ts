import { useSyncExternalStore } from 'react'
import { ApiError, api } from './api'
import type { NodeDto } from './types'
import { makeThumb } from './thumb'

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error'

export interface UploadItem {
  id: string
  file: File
  name: string
  size: number
  parentId: string | null
  loaded: number
  status: UploadStatus
  error?: string
}

const CHUNK_SIZE = 8 * 1024 * 1024
const FAST_PATH_MAX = CHUNK_SIZE
const FILE_CONCURRENCY = 2
const CHUNK_CONCURRENCY = 3
const RENAME_TRIES = 5

export const REFRESH_EVENT = 'md-nodes-changed'

class UploadStore {
  private items: UploadItem[] = []
  private listeners = new Set<() => void>()
  private snapshot: UploadItem[] = []
  private running = 0

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  getSnapshot = (): UploadItem[] => this.snapshot

  private emit() {
    this.snapshot = [...this.items]
    for (const l of this.listeners) l()
  }

  addFiles(files: File[], parentId: string | null): number {
    const usable = files.filter((f) => f.size > 0 || f.type !== '')
    for (const f of usable) {
      this.items.push({
        id: crypto.randomUUID(),
        file: f,
        name: f.name,
        size: f.size,
        parentId,
        loaded: 0,
        status: 'queued',
      })
    }
    this.emit()
    this.pump()
    return usable.length
  }

  retry(id: string): void {
    const item = this.items.find((i) => i.id === id)
    if (item && item.status === 'error') {
      item.status = 'queued'
      item.loaded = 0
      item.error = undefined
      this.emit()
      this.pump()
    }
  }

  dismiss(id: string): void {
    this.items = this.items.filter((i) => i.id !== id)
    this.emit()
  }

  clearFinished(): void {
    this.items = this.items.filter((i) => i.status === 'uploading' || i.status === 'queued')
    this.emit()
  }

  private async pump(): Promise<void> {
    while (this.running < FILE_CONCURRENCY) {
      const next = this.items.find((i) => i.status === 'queued')
      if (!next) return
      next.status = 'uploading'
      this.emit()
      this.running++
      void this.uploadOne(next).finally(() => {
        this.running--
        window.dispatchEvent(new Event(REFRESH_EVENT))
        this.pump()
      })
    }
  }

  private async uploadOne(item: UploadItem): Promise<void> {
    try {
      const mime = item.file.type || 'application/octet-stream'
      let nodeId: string | null = null
      // 同名冲突自动改名（name (1).ext …）
      for (let attempt = 0; attempt < RENAME_TRIES && nodeId === null; attempt++) {
        const name = attempt === 0 ? item.name : autoRename(item.name, attempt)
        try {
          nodeId =
            item.size <= FAST_PATH_MAX
              ? await this.fast(item, name, mime)
              : await this.multipart(item, name, mime)
        } catch (err) {
          if (err instanceof ApiError && err.code === 'NAME_CONFLICT' && attempt < RENAME_TRIES - 1) continue
          throw err
        }
      }
      if (!nodeId) throw new ApiError(0, 'UNKNOWN')
      const thumb = await makeThumb(item.file)
      if (thumb) await api.send('PUT', `/api/files/${nodeId}/thumb`, thumb).catch(() => {})
      item.status = 'done'
      item.loaded = item.size
      this.emit()
    } catch (err) {
      item.status = 'error'
      item.error = err instanceof ApiError ? err.code : 'NETWORK'
      this.emit()
    }
  }

  private async fast(item: UploadItem, name: string, mime: string): Promise<string> {
    const q = new URLSearchParams({ name, mime })
    if (item.parentId) q.set('parentId', item.parentId)
    const node = await api.send<NodeDto>('POST', `/api/files/fast?${q.toString()}`, item.file)
    return node.id
  }

  private async multipart(item: UploadItem, name: string, mime: string): Promise<string> {
    const init = await api.post<{ fileId: string }>('/api/files/init', {
      name,
      parentId: item.parentId,
      size: item.size,
      mime,
    })
    const total = Math.max(1, Math.ceil(item.size / CHUNK_SIZE))
    const parts: { partNumber: number; etag: string }[] = []
    let completed = 0
    let nextChunk = 0

    const uploadChunk = async (idx: number) => {
      const start = idx * CHUNK_SIZE
      const blob = item.file.slice(start, Math.min(start + CHUNK_SIZE, item.size))
      let lastErr: unknown
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await api.send<{ etag: string }>(
            'PUT',
            `/api/files/${init.fileId}/parts/${idx + 1}`,
            blob,
          )
          parts.push({ partNumber: idx + 1, etag: r.etag })
          completed++
          item.loaded = Math.min(completed * CHUNK_SIZE, item.size)
          this.emit()
          return
        } catch (err) {
          lastErr = err
          await new Promise((r) => setTimeout(r, 600 * 2 ** attempt))
        }
      }
      throw lastErr
    }

    const runners = Array.from({ length: Math.min(CHUNK_CONCURRENCY, total) }, async () => {
      for (;;) {
        const i = nextChunk++
        if (i >= total) return
        await uploadChunk(i)
      }
    })
    await Promise.all(runners)

    parts.sort((a, b) => a.partNumber - b.partNumber)
    await api.post(`/api/files/${init.fileId}/complete`, { parts })
    return init.fileId
  }
}

function autoRename(name: string, n: number): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  return `${base} (${n})${ext}`
}

export const uploads = new UploadStore()

export function useUploads(): UploadItem[] {
  return useSyncExternalStore(uploads.subscribe, uploads.getSnapshot)
}
