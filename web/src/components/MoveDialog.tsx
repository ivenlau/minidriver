import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Folder } from 'lucide-react'
import { api } from '../lib/api'
import type { NodeDto } from '../lib/types'
import { Button, Modal, Spinner, cn } from './ui'

/** 文件夹树形选择（含“移动到这里”） */
export function MoveDialog({
  nodes,
  onClose,
  onMoved,
}: {
  nodes: NodeDto[]
  onClose: () => void
  onMoved: (moved: number) => void
}) {
  const { t } = useTranslation()
  const [folderId, setFolderId] = useState<string | null>(null)
  const [path, setPath] = useState<{ id: string; name: string }[]>([])
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const foldersQuery = useQuery({
    queryKey: ['nodes', folderId ?? 'root', 'folders-only'],
    queryFn: () =>
      api.get<{ items: NodeDto[] }>(
        `/api/nodes?parent=${folderId ?? 'root'}&kind=folder&sort=name&order=asc&limit=200`,
      ),
  })
  const folders = (foldersQuery.data?.items ?? []).filter((f) => !nodes.some((n) => n.id === f.id))
  const movingIds = new Set(nodes.map((n) => n.id))

  const enter = (folder: NodeDto) => {
    setFolderId(folder.id)
    setPath((p) => [...p, { id: folder.id, name: folder.name }])
  }
  const up = () => {
    const parent = path[path.length - 2]
    setFolderId(parent ? parent.id : null)
    setPath((p) => p.slice(0, -1))
  }

  const doMove = async () => {
    setMoving(true)
    setError(null)
    let ok = 0
    let failed = 0
    for (const node of nodes) {
      try {
        await api.patch(`/api/nodes/${node.id}`, { parentId: folderId })
        ok++
      } catch {
        failed++
      }
    }
    setMoving(false)
    onMoved(ok)
    if (failed > 0) setError(String(failed))
    if (ok > 0) onClose()
  }

  return (
    <Modal open onClose={onClose} title={t('files.moveTitle')}>
      <div className="space-y-3">
        <div className="flex min-h-8 items-center gap-1.5 text-[13px] text-muted">
          {folderId && (
            <button onClick={up} className="cursor-pointer rounded-md p-1 hover:bg-surface2 hover:text-text">
              <ArrowLeft size={15} />
            </button>
          )}
          <span className="truncate">
            {t('nav.files')}
            {path.map((p) => (
              <span key={p.id}> / {p.name}</span>
            ))}
          </span>
        </div>
        <div className="max-h-64 min-h-32 overflow-y-auto rounded-xl border border-line">
          {foldersQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : folders.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">—</p>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                onClick={() => enter(f)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left text-sm hover:bg-surface2',
                  movingIds.has(f.id) && 'opacity-40',
                )}
                disabled={movingIds.has(f.id)}
              >
                <Folder size={17} className="text-accent" />
                <span className="truncate">{f.name}</span>
              </button>
            ))
          )}
        </div>
        {error && <p className="text-[13px] text-danger">{t('errors.CYCLE_FORBIDDEN')}</p>}
        <div className="flex justify-end gap-2.5">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={doMove} disabled={moving}>
            {moving ? <Spinner size={15} /> : null}
            {t('files.moveHere')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
