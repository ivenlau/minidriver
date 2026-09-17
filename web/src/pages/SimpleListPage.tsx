import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Clock, Download, FolderInput, Pencil, Star, StarOff, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { NodeDto } from '../lib/types'
import { downloadNodes } from '../lib/download'
import { useShell } from '../layout/AppShell'
import { NodeRow } from './FilesPage'
import { canEdit } from '../components/MarkdownEditor'
import { BatchBar } from '../components/BatchBar'
import { ShareDialog } from '../components/ShareDialog'
import { MoveDialog } from '../components/MoveDialog'
import { Button, ConfirmDialog, EmptyState, SkeletonList, type MenuItem } from '../components/ui'
import { useToast } from '../state/toast'

/** 星标 / 最近：单条操作 + 多选批量（下载/移动/移入回收站，星标页额外支持批量取消星标） */
export function SimpleListPage({ mode }: { mode: 'starred' | 'recent' }) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { openPreview } = useShell()
  const [shareNode, setShareNode] = useState<NodeDto | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moveOpen, setMoveOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const listQuery = useQuery({
    queryKey: [mode],
    queryFn: () => api.get<{ items: NodeDto[] }>(`/api/${mode}`),
  })
  const items = useMemo(
    () => (listQuery.data?.items ?? []).filter((n) => mode !== 'starred' || n.starred),
    [listQuery.data, mode],
  )
  const selectedNodes = useMemo(() => items.filter((n) => selected.has(n.id)), [items, selected])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(new Set())
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const invalidate = () => {
    for (const key of ['nodes', 'recent', 'starred', 'trash', 'storage', 'shares']) {
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

  const starMutation = useMutation({
    mutationFn: ({ node, starred }: { node: NodeDto; starred: boolean }) =>
      api.patch(`/api/nodes/${node.id}`, { starred }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['starred'] }),
  })

  const deleteSelected = async () => {
    let failed = 0
    for (const n of selectedNodes) {
      try {
        await api.del(`/api/nodes/${n.id}`)
      } catch {
        failed++
      }
    }
    clearSel()
    invalidate()
    if (failed) toast(t('files.deleteFailed'), 'error')
  }
  const unstarSelected = async () => {
    for (const n of selectedNodes) {
      await api.patch(`/api/nodes/${n.id}`, { starred: false }).catch(() => {})
    }
    clearSel()
    void qc.invalidateQueries({ queryKey: ['starred'] })
  }

  const openNode = (node: NodeDto) => {
    if (node.type === 'folder') navigate(`/files/${node.id}`)
    else openPreview(node)
  }

  const menuFor = (node: NodeDto): MenuItem[] => [
    { label: t('common.open'), onSelect: () => openNode(node) },
    {
      label: t('files.edit'),
      icon: <Pencil size={15} />,
      hidden: !canEdit(node),
      onSelect: () => openPreview(node, { edit: true }),
    },
    {
      label: t('common.share'),
      hidden: node.type !== 'file',
      onSelect: () => setShareNode(node),
    },
    {
      label: t('files.unstar'),
      hidden: mode !== 'starred',
      onSelect: () => starMutation.mutate({ node, starred: false }),
    },
  ]

  return (
    <div className="mx-auto max-w-5xl px-2 py-4 md:px-6">
      <h1 className="px-3 pb-3 text-lg font-semibold">{t(`nav.${mode}`)}</h1>
      {listQuery.isLoading ? (
        <SkeletonList />
      ) : items.length === 0 ? (
        <EmptyState
          icon={mode === 'starred' ? <Star size={26} /> : <Clock size={26} />}
          title={t(`files.${mode}Empty`)}
          hint={mode === 'starred' ? t('files.starredHint') : undefined}
        />
      ) : (
        items.map((node) => (
          <NodeRow
            key={node.id}
            node={node}
            lang={i18n.language}
            selected={selected.has(node.id)}
            anySelected={selected.size > 0}
            onToggleSelect={toggleSelect}
            onOpen={() => openNode(node)}
            menu={menuFor(node)}
          />
        ))
      )}

      {selected.size > 0 && (
        <BatchBar label={t('files.selected', { count: selected.size })} onClear={clearSel}>
          <Button
            variant="ghost"
            size="icon"
            title={t('common.download')}
            onClick={() => downloadNodes(selectedNodes.filter((n) => n.type === 'file'))}
          >
            <Download size={17} />
          </Button>
          <Button variant="ghost" size="icon" title={t('common.move')} onClick={() => setMoveOpen(true)}>
            <FolderInput size={17} />
          </Button>
          {mode === 'starred' && (
            <Button variant="ghost" size="icon" title={t('files.unstar')} onClick={() => void unstarSelected()}>
              <StarOff size={17} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            title={t('common.delete')}
            className="text-danger hover:bg-danger-soft"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={17} />
          </Button>
        </BatchBar>
      )}

      {moveOpen && (
        <MoveDialog
          nodes={selectedNodes}
          onClose={() => setMoveOpen(false)}
          onMoved={(ok) => {
            clearSel()
            invalidate()
            if (ok > 0) toast(t('files.moved'), 'success')
          }}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={t('common.delete')}
        message={t('files.deleteConfirm', { count: selected.size })}
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void deleteSelected()}
      />
      {shareNode && <ShareDialog node={shareNode} onClose={() => setShareNode(null)} />}
    </div>
  )
}
