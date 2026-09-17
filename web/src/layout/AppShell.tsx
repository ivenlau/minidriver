import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  FolderOpen,
  History,
  Link2,
  LogOut,
  Settings,
  Star,
  Trash2,
} from 'lucide-react'
import { api } from '../lib/api'
import { useStorage } from '../state/auth'
import type { NodeDto } from '../lib/types'
import { formatBytes } from '../lib/format'
import { REFRESH_EVENT } from '../lib/upload'
import { Dropdown, cn } from '../components/ui'
import { UploadManager } from '../components/UploadManager'
import { PreviewModal } from '../components/PreviewModal'
import { LangToggle, ThemeToggle } from '../components/ThemeLang'
import { SearchBox } from '../components/SearchBox'
import { Logo } from '../components/Logo'

export type ShellContext = {
  /** 打开预览弹窗；edit: true 直接进入编辑模式 */
  openPreview: (node: NodeDto, opts?: { edit?: boolean }) => void
}

export function useShell(): ShellContext {
  return useOutletContext<ShellContext>()
}

const NAV = [
  { to: '/files', icon: FolderOpen, key: 'nav.files' },
  { to: '/starred', icon: Star, key: 'nav.starred' },
  { to: '/recent', icon: History, key: 'nav.recent' },
  { to: '/shares', icon: Link2, key: 'nav.shares' },
  { to: '/trash', icon: Trash2, key: 'nav.trash' },
] as const

export function AppShell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [previewNode, setPreviewNode] = useState<NodeDto | null>(null)
  const [previewEdit, setPreviewEdit] = useState(false)

  useEffect(() => {
    const refresh = () => {
      for (const key of ['nodes', 'recent', 'starred', 'trash', 'storage', 'shares']) {
        qc.invalidateQueries({ queryKey: [key] })
      }
    }
    window.addEventListener(REFRESH_EVENT, refresh)
    return () => window.removeEventListener(REFRESH_EVENT, refresh)
  }, [qc])

  const signOut = async () => {
    await api.post('/api/auth/logout').catch(() => {})
    qc.clear()
    navigate('/login', { replace: true })
  }

  const openPreview = (node: NodeDto, opts?: { edit?: boolean }) => {
    setPreviewNode(node)
    setPreviewEdit(!!opts?.edit)
  }
  const closePreview = () => {
    setPreviewNode(null)
    setPreviewEdit(false)
    // 编辑可能改动了内容大小/时间
    for (const key of ['nodes', 'recent', 'starred']) {
      void qc.invalidateQueries({ queryKey: [key] })
    }
  }

  return (
    <div className="flex h-dvh bg-bg text-text">
      {/* 侧栏（桌面） */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex h-14 items-center gap-2.5 px-5">
          <Logo size={32} />
          <span className="text-[15px] font-semibold tracking-tight">{t('common.appName')}</span>
        </div>
        <nav className="mt-2 flex-1 space-y-0.5 px-3">
          {NAV.map(({ to, icon: Icon, key }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-colors',
                  isActive ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-surface2 hover:text-text',
                )
              }
            >
              <Icon size={18} />
              {t(key)}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 pb-3">
          <StorageMeter />
        </div>
      </aside>

      {/* 主区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:px-5">
          <div className="flex items-center gap-2 md:hidden">
            <Logo size={28} />
            <span className="text-sm font-semibold">{t('common.appName')}</span>
          </div>
          <div className="hidden flex-1 justify-center md:flex">
            <SearchBox onOpenFile={openPreview} />
          </div>
          <div className="flex flex-1 items-center justify-end gap-0.5 md:flex-none">
            <ThemeToggle />
            <LangToggle />
            <Dropdown
              trigger={
                <button
                  aria-label={t('nav.settings')}
                  className="ml-0.5 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent transition-colors hover:brightness-95"
                >
                  <Settings size={17} />
                </button>
              }
              items={[
                { label: t('nav.settings'), icon: <Settings size={15} />, onSelect: () => navigate('/settings') },
                {
                  label: t('settings.signOut'),
                  icon: <LogOut size={15} />,
                  danger: true,
                  onSelect: () => void signOut(),
                },
              ]}
            />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto pb-20 md:pb-0">
          <Outlet context={{ openPreview } satisfies ShellContext} />
        </main>

        {/* 底部导航（移动） */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {NAV.map(({ to, icon: Icon, key }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex h-16 flex-col items-center justify-center gap-1 text-[11px] transition-colors',
                  isActive ? 'text-accent' : 'text-muted',
                )
              }
            >
              <Icon size={21} />
              {t(key)}
            </NavLink>
          ))}
        </nav>
      </div>

      <UploadManager />
      <PreviewModal node={previewNode} startInEdit={previewEdit} onClose={closePreview} />
    </div>
  )
}

function StorageMeter() {
  const { t } = useTranslation()
  const { data } = useStorage()
  // R2 免费层 10GB 作为展示基准
  const QUOTA = 10 * 1024 * 1024 * 1024
  const used = data?.used ?? 0
  const pct = Math.min(100, (used / QUOTA) * 100)
  return (
    <div className="rounded-xl bg-surface2 px-3.5 py-3">
      <div className="flex items-center justify-between text-[12px] text-muted">
        <span>{t('settings.used')}</span>
        <span className="font-medium text-text">{formatBytes(used)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface3">
        <div
          className={cn('h-full rounded-full transition-all', pct > 90 ? 'bg-danger' : 'bg-accent')}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        {t('settings.filesCount', { count: data?.fileCount ?? 0 })}
        {data && data.trashCount > 0 ? ` · ${t('settings.inTrash', { count: data.trashCount, size: formatBytes(data.trashBytes) })}` : ''}
      </p>
    </div>
  )
}
