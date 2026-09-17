import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Clock, Star } from 'lucide-react'
import { api } from '../lib/api'
import type { NodeDto } from '../lib/types'
import { useShell } from '../layout/AppShell'
import { NodeRow } from './FilesPage'
import { ShareDialog } from '../components/ShareDialog'
import { EmptyState, SkeletonList, type MenuItem } from '../components/ui'
import { useToast } from '../state/toast'

/** 星标 / 最近 两个简单列表页 */
export function SimpleListPage({ mode }: { mode: 'starred' | 'recent' }) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { openPreview } = useShell()
  const [shareNode, setShareNode] = useState<NodeDto | null>(null)

  const listQuery = useQuery({
    queryKey: [mode],
    queryFn: () => api.get<{ items: NodeDto[] }>(`/api/${mode}`),
  })
  const items = useMemo(
    () => (listQuery.data?.items ?? []).filter((n) => mode !== 'starred' || n.starred),
    [listQuery.data, mode],
  )

  const starMutation = useMutation({
    mutationFn: ({ node, starred }: { node: NodeDto; starred: boolean }) =>
      api.patch(`/api/nodes/${node.id}`, { starred }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['starred'] }),
  })

  const openNode = (node: NodeDto) => {
    if (node.type === 'folder') navigate(`/files/${node.id}`)
    else openPreview(node)
  }

  const menuFor = (node: NodeDto): MenuItem[] => [
    { label: t('common.open'), onSelect: () => openNode(node) },
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
            selected={false}
            anySelected={false}
            onToggleSelect={() => {}}
            onOpen={() => openNode(node)}
            menu={menuFor(node)}
          />
        ))
      )}
      {shareNode && <ShareDialog node={shareNode} onClose={() => setShareNode(null)} />}
    </div>
  )
}
