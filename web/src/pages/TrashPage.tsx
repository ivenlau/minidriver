import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { RotateCcw, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { NodeDto } from '../lib/types'
import { formatRelative } from '../lib/format'
import { NodeRow } from './FilesPage'
import { useShell } from '../layout/AppShell'
import { BatchBar } from '../components/BatchBar'
import { Button, ConfirmDialog, EmptyState, SkeletonList, type MenuItem } from '../components/ui'
import { useToast } from '../state/toast'

/** 回收站：单条恢复/彻底删除 + 多选批量（恢复所选 / 彻底删除所选） */
export function TrashPage() {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { openPreview } = useShell()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmHard, setConfirmHard] = useState<NodeDto | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [confirmBatchPurge, setConfirmBatchPurge] = useState(false)

  const listQuery = useQuery({
    queryKey: ['trash'],
    queryFn: () => api.get<{ items: NodeDto[] }>('/api/trash'),
  })
  const items = listQuery.data?.items ?? []
  const selectedNodes = useMemo(() => items.filter((n) => selected.has(n.id)), [items, selected])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(new Set())
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const invalidate = () => {
    for (const key of ['trash', 'nodes', 'recent', 'starred', 'storage']) {
      void qc.invalidateQueries({ queryKey: [key] })
    }
  }
  const clearSel = () => setSelected(new Set())
  const toggleSelect = (id: string, additive: boolean) => {
    setSelected((prev) => {
      const next = new Set(additive ? prev : [])
      if (prev.has(id) && additive) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/nodes/${id}/restore`),
    onSuccess: () => {
      invalidate()
      toast(t('trash.restored'), 'success')
    },
    onError: (err) => toast(t(`errors.${err instanceof Error && 'code' in err ? (err as { code: string }).code : 'UNKNOWN'}`), 'error'),
  })

  const hardDelete = async (node: NodeDto) => {
    try {
      await api.del(`/api/nodes/${node.id}?hard=1`)
      invalidate()
    } catch {
      toast(t('errors.UNKNOWN'), 'error')
    }
  }

  const restoreSelected = async () => {
    let ok = 0
    for (const n of selectedNodes) {
      try {
        await api.post(`/api/nodes/${n.id}/restore`)
        ok++
      } catch {
        /* 单条失败继续 */
      }
    }
    clearSel()
    invalidate()
    if (ok > 0) toast(t('trash.restored'), 'success')
  }
  const purgeSelected = async () => {
    let failed = 0
    for (const n of selectedNodes) {
      try {
        await api.del(`/api/nodes/${n.id}?hard=1`)
      } catch {
        failed++
      }
    }
    clearSel()
    invalidate()
    if (failed) toast(t('files.deleteFailed'), 'error')
  }
  const emptyTrash = async () => {
    for (const node of items) {
      await api.del(`/api/nodes/${node.id}?hard=1`).catch(() => {})
    }
    invalidate()
  }

  const menuFor = (node: NodeDto): MenuItem[] => [
    { label: t('common.restore'), icon: <RotateCcw size={15} />, onSelect: () => restoreMutation.mutate(node.id) },
    {
      label: t('common.delete'),
      icon: <Trash2 size={15} />,
      danger: true,
      onSelect: () => setConfirmHard(node),
    },
  ]

  const deletedLine = (node: NodeDto) => (
    <>
      {t('trash.deletedAt', { time: formatRelative(node.deletedAt ?? 0, i18n.language) })}
      {node.path && node.path.length > 0 && (
        <span className="mx-1.5">· {t('trash.originalPath', { path: node.path.map((p) => p.name).join(' / ') || '—' })}</span>
      )}
    </>
  )

  return (
    <div className="mx-auto max-w-5xl px-2 py-4 md:px-6">
      <div className="flex items-center justify-between px-3 pb-3">
        <h1 className="text-lg font-semibold">{t('trash.title')}</h1>
        {items.length > 0 && (
          <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmEmpty(true)}>
            <Trash2 size={15} />
            {t('trash.emptyTrash')}
          </Button>
        )}
      </div>
      {listQuery.isLoading ? (
        <SkeletonList />
      ) : items.length === 0 ? (
        <EmptyState icon={<Trash2 size={26} />} title={t('trash.empty')} />
      ) : (
        items.map((node) => (
          <div key={node.id}>
            <div className="px-3 pb-1 text-[12px] text-muted md:hidden">{deletedLine(node)}</div>
            <NodeRow
              node={node}
              lang={i18n.language}
              selected={selected.has(node.id)}
              anySelected={selected.size > 0}
              onToggleSelect={toggleSelect}
              onOpen={() => {
                if (node.type === 'file') openPreview(node)
                else navigate(`/files/${node.id}`)
              }}
              menu={menuFor(node)}
            />
            <p className="hidden px-3 pb-1 text-[12px] text-muted md:block">{deletedLine(node)}</p>
          </div>
        ))
      )}

      {selected.size > 0 && (
        <BatchBar label={t('files.selected', { count: selected.size })} onClear={clearSel}>
          <Button variant="ghost" size="icon" title={t('common.restore')} onClick={() => void restoreSelected()}>
            <RotateCcw size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={t('common.delete')}
            className="text-danger hover:bg-danger-soft"
            onClick={() => setConfirmBatchPurge(true)}
          >
            <Trash2 size={17} />
          </Button>
        </BatchBar>
      )}

      <ConfirmDialog
        open={!!confirmHard}
        title={t('common.delete')}
        message={confirmHard ? t('trash.hardDeleteConfirm', { name: confirmHard.name }) : undefined}
        danger
        onClose={() => setConfirmHard(null)}
        onConfirm={() => confirmHard && void hardDelete(confirmHard)}
      />
      <ConfirmDialog
        open={confirmBatchPurge}
        title={t('common.delete')}
        message={t('trash.hardDeleteBatch', { count: selected.size })}
        danger
        onClose={() => setConfirmBatchPurge(false)}
        onConfirm={() => void purgeSelected()}
      />
      <ConfirmDialog
        open={confirmEmpty}
        title={t('trash.emptyTrash')}
        message={t('trash.emptyTrashConfirm')}
        danger
        onClose={() => setConfirmEmpty(false)}
        onConfirm={() => void emptyTrash()}
      />
    </div>
  )
}
