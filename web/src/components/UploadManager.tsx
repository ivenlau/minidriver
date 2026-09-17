import { useEffect, useState } from 'react'
import { AlertCircle, Check, Loader2, Minus, RotateCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { uploads, useUploads } from '../lib/upload'
import type { UploadItem } from '../lib/upload'
import { formatBytes } from '../lib/format'
import { Button, cn } from './ui'
import { fileKind, KindIcon } from './FileIcon'

/** 容器：移动端位于底部任务栏（含安全区）之上，桌面右下角 */
const CONTAINER =
  'fixed right-3 z-40 overflow-hidden rounded-2xl border border-line bg-surface shadow-pop md:bottom-5 md:right-5 bottom-[calc(4rem_+_env(safe-area-inset-bottom)_+_0.75rem)]'

/** 上传面板：进行中 = 活动项清单；结束 = 自动收纳的结果胶囊（成功 5s 自动消失，有失败停留可重试） */
export function UploadManager() {
  const { t } = useTranslation()
  const items = useUploads()
  const [minimized, setMinimized] = useState(false)

  const active = items.filter((i) => i.status === 'uploading' || i.status === 'queued')
  const failed = items.filter((i) => i.status === 'error')
  const done = items.length - active.length - failed.length
  const allSettled = active.length === 0

  // 全部成功：5 秒后自动清除；有失败：停留等待处理
  useEffect(() => {
    if (items.length > 0 && allSettled && failed.length === 0) {
      const timer = setTimeout(() => uploads.clearFinished(), 5000)
      return () => clearTimeout(timer)
    }
  }, [items, allSettled, failed.length])

  if (items.length === 0) return null

  // 结果胶囊：全部结束
  if (allSettled) {
    return (
      <div className={cn(CONTAINER, 'w-auto max-w-[calc(100dvw-24px)]')}>
        <div className="flex items-center gap-2.5 px-4 py-2.5">
          {failed.length > 0 ? (
            <AlertCircle size={16} className="shrink-0 text-danger" />
          ) : (
            <Check size={16} className="shrink-0 text-accent" />
          )}
          <span className="whitespace-nowrap text-[13px] font-medium">
            {failed.length > 0
              ? t('files.uploadResult', { success: done, failed: failed.length })
              : t('files.uploadDoneCount', { count: done })}
          </span>
          {failed.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-accent"
              onClick={() => uploads.retryAllFailed()}
            >
              <RotateCw size={13} />
              {t('files.retryAll')}
            </Button>
          )}
          <button
            onClick={() => uploads.clearFinished()}
            className="-mr-1 cursor-pointer rounded-md p-1 text-muted hover:bg-surface2 hover:text-text"
            aria-label={t('common.clear')}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  // 迷你胶囊：进行中手动收起
  if (minimized) {
    return (
      <div className={cn(CONTAINER, 'w-auto')}>
        <button
          onClick={() => setMinimized(false)}
          className="flex cursor-pointer items-center gap-2 px-4 py-2.5"
        >
          <Loader2 size={16} className="animate-spin text-accent" />
          <span className="text-[13px] font-medium">
            {items.length - active.length}/{items.length}
          </span>
        </button>
      </div>
    )
  }

  // 展开清单：仅显示活动项（上传中/排队/失败）
  return (
    <div className={cn(CONTAINER, 'w-[calc(100dvw-24px)] max-w-sm')}>
      <button
        onClick={() => setMinimized(true)}
        className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 text-left"
      >
        <Loader2 size={16} className="shrink-0 animate-spin text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{t('files.uploadQueue')}</span>
        <span className="shrink-0 text-xs text-muted">
          {done}/{items.length}
        </span>
        <Minus size={15} className="shrink-0 text-muted" />
      </button>
      <div className="max-h-64 divide-y divide-line overflow-y-auto">
        {active.map((item) => (
          <UploadRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}

function UploadRow({ item }: { item: UploadItem }) {
  const { t } = useTranslation()
  const pct = item.size > 0 ? Math.min(100, Math.round((item.loaded / item.size) * 100)) : 0
  const failed = item.status === 'error'
  const queued = item.status === 'queued'

  return (
    <div className="flex items-start gap-2.5 px-4 py-2.5">
      <KindIcon kind={fileKind({ type: 'file', mime: item.file.type, name: item.name })} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 flex-1 truncate text-[13px] text-text">{item.name}</p>
          <span
            className={cn(
              'shrink-0 text-[11px]',
              failed ? 'text-danger' : 'text-muted',
            )}
          >
            {failed
              ? t('files.uploadFailed')
              : queued
                ? t('files.queued')
                : `${formatBytes(item.loaded)} / ${formatBytes(item.size)}`}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface2">
            <div
              className={cn('h-full rounded-full transition-all', failed ? 'bg-danger' : 'bg-accent')}
              style={{ width: `${failed ? 100 : pct}%` }}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-[11px] text-muted">
            {failed
              ? t('common.retry')
              : queued
                ? '—'
                : `${pct}%${item.speed ? ` · ${formatBytes(item.speed)}/s` : ''}`}
          </span>
          {failed && (
            <button
              onClick={() => uploads.retry(item.id)}
              className="shrink-0 cursor-pointer rounded-md p-1 text-muted hover:bg-surface2 hover:text-text"
              title={t('common.retry')}
            >
              <RotateCw size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
