import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ChevronRight,
  CloudUpload,
  Download,
  FilePlus,
  FolderPlus,
  Grid2x2,
  ArrowUpDown,
  Home,
  Link2,
  List,
  MoreVertical,
  Pencil,
  FolderInput,
  Star,
  Trash2,
  Upload,
} from 'lucide-react'
import { api } from '../lib/api'
import type { NodeDto, NodeList } from '../lib/types'
import { formatBytes, formatRelative } from '../lib/format'
import { downloadNodes } from '../lib/download'
import { useShell } from '../layout/AppShell'
import { uploads } from '../lib/upload'
import { FileIcon, fileKind } from '../components/FileIcon'
import { canEdit } from '../components/MarkdownEditor'
import { BatchBar } from '../components/BatchBar'
import { ShareDialog } from '../components/ShareDialog'
import { MoveDialog } from '../components/MoveDialog'
import {
  Button,
  ConfirmDialog,
  Dropdown,
  EmptyState,
  PromptDialog,
  SkeletonList,
  cn,
  type MenuItem,
} from '../components/ui'
import { useToast } from '../state/toast'

type SortKey = 'name' | 'size' | 'updated_at' | 'created_at'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'updated_at', label: 'files.sortRecent' },
  { key: 'name', label: 'files.sortName' },
  { key: 'size', label: 'files.sortSize' },
  { key: 'created_at', label: 'files.sortCreated' },
]

function readPref<T extends string>(key: string, fallback: T): T {
  const v = localStorage.getItem(key)
  return (v as T) ?? fallback
}

export function FilesPage() {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const { folderId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { openPreview } = useShell()

  const [sort, setSort] = useState<SortKey>(() => readPref('md.sort', 'updated_at'))
  const [order, setOrder] = useState<'asc' | 'desc'>(() => readPref('md.order', 'desc'))
  const [view, setView] = useState<'list' | 'grid'>(() => readPref('md.view', 'list'))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState(false)

  const [shareNode, setShareNode] = useState<NodeDto | null>(null)
  const [moveNodes, setMoveNodes] = useState<NodeDto[] | null>(null)
  const [renameNode, setRenameNode] = useState<NodeDto | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<NodeDto[] | null>(null)
  const [newTextKind, setNewTextKind] = useState<'text/markdown' | 'text/plain' | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const parentParam = folderId ?? 'root'
  const listQuery = useQuery({
    queryKey: ['nodes', parentParam, sort, order],
    queryFn: async () => {
      const all: NodeDto[] = []
      let cursor: string | undefined
      // 一次性拉取当前目录全量（目录页数量有限），避免分页断裂的复杂度
      for (;;) {
        const page = await api.get<NodeList>(
          `/api/nodes?parent=${encodeURIComponent(parentParam)}&sort=${sort}&order=${order}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        )
        all.push(...page.items)
        cursor = page.nextCursor ?? undefined
        if (!cursor || all.length > 2000) break
      }
      return all
    },
  })

  const folderQuery = useQuery({
    queryKey: ['node', folderId],
    queryFn: () => api.get<NodeDto>(`/api/nodes/${folderId}`),
    enabled: !!folderId,
  })

  const items = useMemo(() => {
    const list = [...(listQuery.data ?? [])]
    // 文件夹恒在文件前，页内按当前排序
    list.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      if (sort === 'name') {
        return order === 'asc' ? a.name.localeCompare(b.name, i18n.language) : b.name.localeCompare(a.name, i18n.language)
      }
      const av = sort === 'size' ? (a.size ?? 0) : sort === 'created_at' ? a.createdAt : a.updatedAt
      const bv = sort === 'size' ? (b.size ?? 0) : sort === 'created_at' ? b.createdAt : b.updatedAt
      return order === 'asc' ? av - bv : bv - av
    })
    return list
  }, [listQuery.data, sort, order, i18n.language])

  const selectedNodes = useMemo(() => items.filter((n) => selected.has(n.id)), [items, selected])

  // ?open=<id>（搜索结果跳转）→ 直接打开预览
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId) return
    setSearchParams({}, { replace: true })
    void api.get<NodeDto>(`/api/nodes/${openId}`).then(openPreview).catch(() => {})
  }, [searchParams, setSearchParams, openPreview])

  const invalidate = useCallback(() => {
    for (const key of ['nodes', 'recent', 'starred', 'trash', 'storage', 'shares']) {
      void qc.invalidateQueries({ queryKey: [key] })
    }
  }, [qc])

  const setPref = (key: string, value: string) => {
    localStorage.setItem(key, value)
    if (key === 'md.sort') setSort(value as SortKey)
    if (key === 'md.order') setOrder(value as 'asc' | 'desc')
    if (key === 'md.view') setView(value as 'list' | 'grid')
  }

  const toggleSelect = (id: string, additive: boolean) => {
    setSelected((prev) => {
      const next = new Set(additive ? prev : [])
      if (prev.has(id) && additive) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openNode = (node: NodeDto) => {
    if (node.type === 'folder') {
      setSelected(new Set())
      navigate(`/files/${node.id}`)
    } else {
      openPreview(node)
    }
  }

  const download = (nodes: NodeDto[]) => {
    downloadNodes(nodes.filter((n) => n.type === 'file'))
  }

  const starMutation = useMutation({
    mutationFn: ({ node, starred }: { node: NodeDto; starred: boolean }) =>
      api.patch(`/api/nodes/${node.id}`, { starred }),
    onSuccess: invalidate,
  })

  const deleteNodes = async (nodes: NodeDto[]) => {
    let failed = 0
    for (const n of nodes) {
      try {
        await api.del(`/api/nodes/${n.id}`)
      } catch {
        failed++
      }
    }
    setSelected(new Set())
    invalidate()
    if (failed > 0) toast(t('files.deleteFailed'), 'error')
  }

  // 全窗口拖放上传
  useEffect(() => {
    let depth = 0
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      depth++
      setDragOver(true)
    }
    const onLeave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragOver(false)
    }
    const onDrop = (e: DragEvent) => {
      depth = 0
      setDragOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length > 0) {
        e.preventDefault()
        uploads.addFiles(files, folderId ?? null)
      }
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', (e) => e.preventDefault())
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [folderId])

  // Esc 清除多选 / Delete 删除
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(new Set())
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size > 0 && !(e.target as HTMLElement).closest('input,textarea')) {
        e.preventDefault()
        setConfirmDelete(selectedNodes)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected, selectedNodes])

  const crumbs = folderId ? (folderQuery.data?.path ?? []) : []

  const menuFor = (node: NodeDto): MenuItem[] => [
    {
      label: t('common.open'),
      icon: <ChevronRight size={15} />,
      onSelect: () => openNode(node),
    },
    {
      label: t('files.edit'),
      icon: <Pencil size={15} />,
      hidden: !canEdit(node),
      onSelect: () => openPreview(node, { edit: true }),
    },
    {
      label: t('common.download'),
      icon: <Download size={15} />,
      hidden: node.type !== 'file',
      onSelect: () => download([node]),
    },
    {
      label: t('common.share'),
      icon: <Link2 size={15} />,
      hidden: node.type !== 'file',
      onSelect: () => setShareNode(node),
    },
    {
      label: node.starred ? t('files.unstar') : t('files.star'),
      icon: <Star size={15} />,
      onSelect: () => starMutation.mutate({ node, starred: !node.starred }),
    },
    {
      label: t('common.rename'),
      icon: <Pencil size={15} />,
      onSelect: () => setRenameNode(node),
    },
    {
      label: t('common.move'),
      icon: <FolderInput size={15} />,
      onSelect: () => setMoveNodes([node]),
    },
    {
      label: t('common.delete'),
      icon: <Trash2 size={15} />,
      danger: true,
      onSelect: () => setConfirmDelete([node]),
    },
  ]

  const isEmpty = !listQuery.isLoading && items.length === 0

  return (
    <div className="relative flex h-full flex-col">
      {/* 工具栏 */}
      <div className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="flex items-center gap-2 px-4 py-2.5 md:px-6">
          <Breadcrumbs crumbs={crumbs} loading={!!folderId && folderQuery.isLoading} />
          <div className="flex-1" />
          <Dropdown
            align="right"
            trigger={
              <Button variant="ghost" size="sm" title={t('files.sortBy')}>
                <ArrowUpDown size={16} />
                <span className="hidden sm:inline">{t(SORTS.find((s) => s.key === sort)!.label)}</span>
              </Button>
            }
            items={SORTS.map((s) => ({
              label: t(s.label),
              onSelect: () => setPref('md.sort', s.key),
            }))}
          />
          <Button
            variant="ghost"
            size="icon"
            title={view === 'list' ? t('files.grid') : t('files.list')}
            onClick={() => setPref('md.view', view === 'list' ? 'grid' : 'list')}
          >
            {view === 'list' ? <Grid2x2 size={17} /> : <List size={17} />}
          </Button>
          <Button variant="ghost" size="icon" title={t('files.newFolder')} onClick={() => setNewFolderOpen(true)}>
            <FolderPlus size={17} />
          </Button>
          <Dropdown
            align="right"
            trigger={
              <Button variant="ghost" size="icon" title={t('files.newText')}>
                <FilePlus size={17} />
              </Button>
            }
            items={[
              { label: t('files.newMarkdown'), onSelect: () => setNewTextKind('text/markdown') },
              { label: t('files.newText'), onSelect: () => setNewTextKind('text/plain') },
            ]}
          />
          <Button variant="primary" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload size={15} />
            <span className="hidden sm:inline">{t('files.upload')}</span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length > 0) uploads.addFiles(files, folderId ?? null)
              e.target.value = ''
            }}
          />
        </div>
        {/* 移动端搜索 */}
        <div className="px-4 pb-2.5 md:hidden">
          <MobileSearch />
        </div>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto px-2 pb-6 md:px-4">
        {listQuery.isLoading ? (
          <SkeletonList />
        ) : isEmpty ? (
          <EmptyState
            icon={<CloudUpload size={26} />}
            title={t('files.emptyTitle')}
            hint={t('files.emptyHint')}
          />
        ) : view === 'list' ? (
          <div className="max-w-5xl">
            {items.map((node) => (
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
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 p-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {items.map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                lang={i18n.language}
                selected={selected.has(node.id)}
                anySelected={selected.size > 0}
                onToggleSelect={toggleSelect}
                onOpen={() => openNode(node)}
                menu={menuFor(node)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 批量操作栏 */}
      {selected.size > 0 && (
        <BatchBar label={t('files.selected', { count: selected.size })} onClear={() => setSelected(new Set())}>
          <Button variant="ghost" size="icon" title={t('common.download')} onClick={() => download(selectedNodes)}>
            <Download size={17} />
          </Button>
          <Button variant="ghost" size="icon" title={t('common.move')} onClick={() => setMoveNodes(selectedNodes)}>
            <FolderInput size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={t('common.delete')}
            className="text-danger hover:bg-danger-soft"
            onClick={() => setConfirmDelete(selectedNodes)}
          >
            <Trash2 size={17} />
          </Button>
        </BatchBar>
      )}

      {/* 拖放遮罩 */}
      {dragOver && (
        <div className="md-fade-in pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-accent/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent bg-surface/90 px-14 py-10 shadow-pop">
            <CloudUpload size={40} className="text-accent" />
            <p className="text-[15px] font-medium">{t('files.uploadHint')}</p>
          </div>
        </div>
      )}

      {/* 对话框 */}
      {shareNode && <ShareDialog node={shareNode} onClose={() => setShareNode(null)} />}
      {moveNodes && (
        <MoveDialog
          nodes={moveNodes}
          onClose={() => setMoveNodes(null)}
          onMoved={(ok) => {
            setSelected(new Set())
            invalidate()
            if (ok > 0) toast(t('files.moved'), 'success')
          }}
        />
      )}
      {renameNode && (
        <PromptDialog
          open
          title={t('files.renameTitle')}
          label={t('common.name')}
          initialValue={renameNode.name}
          confirmLabel={t('common.save')}
          onClose={() => setRenameNode(null)}
          onConfirm={async (name) => {
            try {
              await api.patch(`/api/nodes/${renameNode.id}`, { name })
              invalidate()
            } catch (err) {
              toast(t(`errors.${err instanceof Error && 'code' in err ? (err as { code: string }).code : 'UNKNOWN'}`), 'error')
            }
          }}
        />
      )}
      <PromptDialog
        open={newTextKind !== null}
        title={newTextKind === 'text/markdown' ? t('files.newMarkdown') : t('files.newText')}
        label={t('files.newTextName')}
        placeholder={newTextKind === 'text/markdown' ? 'note.md' : 'note.txt'}
        confirmLabel={t('common.confirm')}
        onClose={() => setNewTextKind(null)}
        onConfirm={async (name) => {
          if (!newTextKind) return
          const ext = newTextKind === 'text/markdown' ? '.md' : '.txt'
          const fullName = name.includes('.') ? name : `${name}${ext}`
          try {
            const created = await api.send<NodeDto>(
              'POST',
              `/api/files/fast?name=${encodeURIComponent(fullName)}&mime=${newTextKind}${folderId ? `&parentId=${folderId}` : ''}`,
              new TextEncoder().encode(''),
            )
            invalidate()
            openPreview(created, { edit: true })
          } catch (err) {
            toast(t(`errors.${err instanceof Error && 'code' in err ? (err as { code: string }).code : 'UNKNOWN'}`), 'error')
          }
        }}
      />
      <PromptDialog
        open={newFolderOpen}
        title={t('files.newFolderTitle')}
        label={t('common.name')}
        placeholder={t('files.namePlaceholder')}
        confirmLabel={t('common.confirm')}
        onClose={() => setNewFolderOpen(false)}
        onConfirm={async (name) => {
          try {
            await api.post('/api/folders', { name, parentId: folderId ?? null })
            invalidate()
          } catch (err) {
            toast(t(`errors.${err instanceof Error && 'code' in err ? (err as { code: string }).code : 'UNKNOWN'}`), 'error')
          }
        }}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title={t('common.delete')}
        message={confirmDelete ? t('files.deleteConfirm', { count: confirmDelete.length }) : undefined}
        danger
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void deleteNodes(confirmDelete)}
      />
    </div>
  )
}

function Breadcrumbs({ crumbs, loading }: { crumbs: { id: string; name: string }[]; loading: boolean }) {
  const { t } = useTranslation()
  return (
    <nav className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm whitespace-nowrap">
      <Link
        to="/files"
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-muted transition-colors hover:bg-surface2 hover:text-text"
      >
        <Home size={15} />
        <span className="hidden sm:inline">{t('nav.files')}</span>
      </Link>
      {loading && <span className="px-1 text-muted">…</span>}
      {crumbs.map((c, i) => (
        <span key={c.id} className="flex items-center gap-1">
          <ChevronRight size={14} className="shrink-0 text-muted/60" />
          {i === crumbs.length - 1 ? (
            <span className="max-w-40 truncate rounded-lg px-2 py-1 font-medium">{c.name}</span>
          ) : (
            <Link to={`/files/${c.id}`} className="max-w-40 truncate rounded-lg px-2 py-1 text-muted hover:bg-surface2 hover:text-text">
              {c.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}

function MobileSearch() {
  const { t } = useTranslation()
  const { openPreview } = useShell()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<NodeDto[] | null>(null)

  useEffect(() => {
    if (!q.trim()) {
      setResults(null)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<{ items: NodeDto[] }>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        setResults(res.items)
      } catch {
        setResults([])
      }
    }, 280)
    return () => clearTimeout(timer)
  }, [q])

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('files.searchPlaceholder')}
        className="h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none"
      />
      {results !== null && (
        <div className="absolute inset-x-0 top-11 z-30 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-pop">
          {results.length === 0 ? (
            <p className="px-4 py-4 text-center text-[13px] text-muted">{t('files.searchEmpty')}</p>
          ) : (
            results.map((node) => (
              <button
                key={node.id}
                onClick={() => {
                  setQ('')
                  setResults(null)
                  if (node.type === 'folder') navigate(`/files/${node.id}`)
                  else openPreview(node)
                }}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface2"
              >
                <FileIcon node={node} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[13px]">{node.name}</span>
                {node.type === 'file' && <span className="text-[11px] text-muted">{formatBytes(node.size)}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 列表行 / 网格卡

function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return
      clear()
      timer.current = setTimeout(onLongPress, 480)
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
  }
}

type ItemProps = {
  node: NodeDto
  lang: string
  selected: boolean
  anySelected: boolean
  onToggleSelect: (id: string, additive: boolean) => void
  onOpen: () => void
  menu: MenuItem[]
}

export function NodeRow({ node, lang, selected, anySelected, onToggleSelect, onOpen, menu }: ItemProps) {
  const { t } = useTranslation()
  const longPress = useLongPress(() => onToggleSelect(node.id, true))
  return (
    <div
      {...longPress}
      onClick={() => (anySelected ? onToggleSelect(node.id, true) : onOpen())}
      onContextMenu={(e) => {
        if (!selected) return
        e.preventDefault()
      }}
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-colors md:py-2.5',
        selected ? 'bg-accent-soft' : 'hover:bg-surface2/70',
      )}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelect(node.id, e.metaKey || e.ctrlKey || anySelected)
        }}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all',
          selected ? 'border-accent bg-accent text-white' : cn('border-line bg-surface', anySelected ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'),
        )}
        aria-label={t('common.selectAll')}
      >
        {selected && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6.5L4.5 9L10 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <FileIcon node={node} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm">
          {node.name}
          {node.starred && <Star size={12} className="shrink-0 fill-amber-400 text-amber-400" />}
        </p>
        <p className="mt-0.5 text-[12px] text-muted md:hidden">
          {node.type === 'folder'
            ? t('files.items', { count: node.childCount ?? 0 })
            : `${formatBytes(node.size)} · ${formatRelative(node.updatedAt, lang)}`}
        </p>
      </div>
      <span className="hidden w-20 shrink-0 text-right text-[12.5px] text-muted md:block">
        {node.type === 'folder' ? t('files.items', { count: node.childCount ?? 0 }) : formatBytes(node.size)}
      </span>
      <span className="hidden w-24 shrink-0 text-right text-[12.5px] text-muted lg:block">
        {formatRelative(node.updatedAt, lang)}
      </span>
      <div className="shrink-0">
        <Dropdown
          trigger={
            <button
              className="cursor-pointer rounded-lg p-1.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-surface3 hover:text-text max-md:opacity-100"
              aria-label={t('common.open')}
            >
              <MoreVertical size={17} />
            </button>
          }
          items={menu}
        />
      </div>
    </div>
  )
}

function NodeCard({ node, lang, selected, anySelected, onToggleSelect, onOpen, menu }: ItemProps) {
  const { t } = useTranslation()
  const longPress = useLongPress(() => onToggleSelect(node.id, true))
  const kind = fileKind(node)
  return (
    <div
      {...longPress}
      onClick={() => (anySelected ? onToggleSelect(node.id, true) : onOpen())}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-2xl border bg-surface transition-all hover:-translate-y-0.5 hover:shadow-card',
        selected ? 'border-accent ring-2 ring-accent/30' : 'border-line',
      )}
    >
      <div className="relative flex aspect-4/3 items-center justify-center bg-surface2">
        {node.hasThumb ? (
          <img src={`/api/nodes/${node.id}/thumb`} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : kind === 'folder' ? (
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <FolderGlyph />
          </div>
        ) : (
          <FileIcon node={node} size="lg" />
        )}
        {node.starred && <Star size={13} className="absolute top-2 right-2 fill-amber-400 text-amber-400 drop-shadow" />}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect(node.id, true)
          }}
          className={cn(
            'absolute top-2 left-2 flex h-5 w-5 items-center justify-center rounded-md border transition-all',
            selected ? 'border-accent bg-accent text-white opacity-100' : 'border-line bg-surface opacity-70 group-hover:opacity-100',
          )}
        >
          {selected && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6.5L4.5 9L10 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
      <div className="flex items-center gap-1 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{node.name}</p>
          <p className="text-[11px] text-muted">
            {node.type === 'folder'
              ? t('files.items', { count: node.childCount ?? 0 })
              : formatRelative(node.updatedAt, lang)}
          </p>
        </div>
        <Dropdown
          trigger={
            <button className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-text">
              <MoreVertical size={16} />
            </button>
          }
          items={menu}
        />
      </div>
    </div>
  )
}

function FolderGlyph() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  )
}
