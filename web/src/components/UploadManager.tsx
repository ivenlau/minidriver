import { useState } from 'react'
import { AlertCircle, Check, ChevronDown, ChevronUp, Loader2, RotateCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { uploads, useUploads } from '../lib/upload'
import type { UploadItem } from '../lib/upload'
import { formatBytes } from '../lib/format'
import { cn } from './ui'

/** 右下角上传队列（桌面）；移动端为底部上方的紧凑条 */
export function UploadManager() {
  const { t } = useTranslation()
  const items = useUploads()
  const [collapsed, setCollapsed] = useState(false)

  if (items.length === 0) return null
  const active = items.filter((i) => i.status === 'uploading' || i.status === 'queued')
  const done = items.filter((i) => i.status === 'done').length
  const failed = items.filter((i) => i.status === 'error').length
  const totalLoaded = items.reduce((s, i) => s + i.loaded, 0)
  const totalSize = items.reduce((s, i) => s + i.size, 0)
  const allSettled = active.length === 0

  return (
    <div
      className={cn(
        'fixed z-40 w-[calc(100dvw-24px)] max-w-sm overflow-hidden rounded-2xl border border-line bg-surface shadow-pop',
        'bottom-[76px] right-3 md:bottom-5 md:right-5',
        collapsed && 'w-56',
      )}
    >
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 text-left text-sm font-medium hover:bg-surface2/60"
      >
        {allSettled ? (
          failed > 0 ? (
            <AlertCircle size={17} className="text-danger" />
          ) : (
            <Check size={17} className="text-accent" />
          )
        ) : (
          <Loader2 size={17} className="animate-spin text-accent" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {allSettled
            ? failed > 0
              ? t('files.uploadFailed')
              : t('files.uploadDone')
            : t('files.uploadQueue')}
        </span>
        <span className="text-xs font-normal text-muted">
          {done + failed}/{items.length}
        </span>
        {collapsed ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
      </button>

      {!collapsed && (
        <>
          <div className="h-1 w-full bg-surface2">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: totalSize > 0 ? `${(totalLoaded / totalSize) * 100}%` : '0%' }}
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {items.map((item) => (
              <UploadRow key={item.id} item={item} />
            ))}
          </div>
          {allSettled && (
            <button
              onClick={() => uploads.clearFinished()}
              className="w-full cursor-pointer border-t border-line px-4 py-2.5 text-[13px] text-muted hover:bg-surface2/60 hover:text-text"
            >
              {t('common.clear')}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function UploadRow({ item }: { item: UploadItem }) {
  const { t } = useTranslation()
  const pct = item.size > 0 ? Math.min(100, (item.loaded / item.size) * 100) : 0
  return (
    <div className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-text">{item.name}</p>
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface2">
            <div
              className={cn('h-full rounded-full transition-all', item.status === 'error' ? 'bg-danger' : 'bg-accent')}
              style={{ width: item.status === 'done' ? '100%' : `${pct}%` }}
            />
          </div>
          <span className="shrink-0 text-[11px] text-muted">
            {item.status === 'error'
              ? t(`errors.${item.error === 'NETWORK' ? 'NETWORK' : 'REQUEST_FAILED'}`)
              : item.status === 'done'
                ? formatBytes(item.size)
                : `${formatBytes(item.loaded)} / ${formatBytes(item.size)}`}
          </span>
        </div>
      </div>
      {item.status === 'error' && (
        <button
          onClick={() => uploads.retry(item.id)}
          className="shrink-0 cursor-pointer rounded-md p-1.5 text-muted hover:bg-surface2 hover:text-text"
          title={t('common.retry')}
        >
          <RotateCw size={14} />
        </button>
      )}
      <button
        onClick={() => uploads.dismiss(item.id)}
        className="shrink-0 cursor-pointer rounded-md p-1.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-surface2 hover:text-text"
        title={t('common.close')}
      >
        <X size={14} />
      </button>
    </div>
  )
}
