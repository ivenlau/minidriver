import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link2, Lock, Pencil, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { ShareDto } from '../lib/types'
import { formatBytes, formatDate, formatRelative } from '../lib/format'
import { FileIcon, fileKind } from '../components/FileIcon'
import { Button, ConfirmDialog, Dropdown, EmptyState, Input, Modal, SkeletonList, cn } from '../components/ui'
import { useToast } from '../state/toast'

const STATUS_STYLE: Record<ShareDto['status'], string> = {
  active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  expired: 'bg-surface3 text-muted',
  exhausted: 'bg-warn-soft text-warn',
  revoked: 'bg-danger-soft text-danger',
}

const EXPIRY_OPTIONS = [
  { value: 3600, key: 'exp1h' },
  { value: 86400, key: 'exp1d' },
  { value: 7 * 86400, key: 'exp7d' },
  { value: 30 * 86400, key: 'exp30d' },
]

export function SharesPage() {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const [revoke, setRevoke] = useState<ShareDto | null>(null)
  const [edit, setEdit] = useState<ShareDto | null>(null)

  const listQuery = useQuery({
    queryKey: ['shares'],
    queryFn: () => api.get<{ items: ShareDto[] }>('/api/shares'),
  })
  const items = listQuery.data?.items ?? []

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['shares'] })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/shares/${id}`),
    onSuccess: invalidate,
  })

  return (
    <div className="mx-auto max-w-4xl px-2 py-4 md:px-6">
      <h1 className="px-3 pb-3 text-lg font-semibold">{t('share.title')}</h1>
      {listQuery.isLoading ? (
        <SkeletonList />
      ) : items.length === 0 ? (
        <EmptyState icon={<Link2 size={26} />} title={t('share.noShares')} hint={t('share.noSharesHint')} />
      ) : (
        <div className="space-y-2">
          {items.map((share) => (
            <div
              key={share.id}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3"
            >
              <div className="h-10 w-10 shrink-0">
                <FileIcon
                  node={{
                    id: share.nodeId,
                    type: 'file',
                    name: share.name,
                    mime: share.mime,
                    hasThumb: fileKind({ type: 'file', mime: share.mime, name: share.name }) === 'image',
                    parentId: null,
                    size: share.size,
                    starred: false,
                    createdAt: share.createdAt,
                    updatedAt: share.createdAt,
                  }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {share.name}
                  {share.hasPassword && <Lock size={12} className="shrink-0 text-muted" />}
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {formatBytes(share.size)} · {t('share.downloads', { count: share.downloadCount })}
                  {share.expiresAt ? ` · ${t('common.expires')} ${formatRelative(share.expiresAt, i18n.language)}` : ''}
                </p>
              </div>
              <span
                className={cn(
                  'hidden shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium sm:block',
                  STATUS_STYLE[share.status],
                )}
              >
                {t(`share.status${share.status[0]!.toUpperCase()}${share.status.slice(1)}`)}
              </span>
              <Dropdown
                trigger={
                  <Button variant="ghost" size="icon">
                    <Pencil size={16} />
                  </Button>
                }
                items={[
                  { label: t('share.editTitle'), onSelect: () => setEdit(share) },
                  {
                    label: t('share.revoke'),
                    icon: <Trash2 size={15} />,
                    danger: true,
                    hidden: share.status !== 'active',
                    onSelect: () => setRevoke(share),
                  },
                ]}
              />
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!revoke}
        title={t('share.revoke')}
        message={t('share.revokeConfirm')}
        danger
        onClose={() => setRevoke(null)}
        onConfirm={() => revoke && revokeMutation.mutate(revoke.id)}
      />
      {edit && <EditShareDialog share={edit} onClose={() => setEdit(null)} onSaved={invalidate} />}
    </div>
  )
}

function EditShareDialog({
  share,
  onClose,
  onSaved,
}: {
  share: ShareDto
  onClose: () => void
  onSaved: () => void
}) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const [expiresIn, setExpiresIn] = useState<number | null>(null)
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {}
      if (expiresIn !== null) body.expiresIn = expiresIn
      if (password !== '') body.password = password
      if (Object.keys(body).length > 0) {
        await api.patch(`/api/shares/${share.id}`, body)
        onSaved()
        toast(t('common.ok'), 'success')
      }
      onClose()
    } catch {
      toast(t('settings.saveFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`${t('share.editTitle')} · ${share.name}`}>
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-[13px] font-medium">{t('share.expiry')}</p>
          <p className="mb-2 text-[12px] text-muted">
            {share.expiresAt ? formatDate(share.expiresAt, i18n.language) : t('common.never')}
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {EXPIRY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setExpiresIn(opt.value)}
                className={cn(
                  'h-9 cursor-pointer rounded-lg border text-[13px] transition-colors',
                  expiresIn === opt.value
                    ? 'border-accent bg-accent-soft font-medium text-accent'
                    : 'border-line text-muted hover:bg-surface2',
                )}
              >
                {t(`share.${opt.key}`)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium">
            {t('share.password')} · <span className="font-normal text-muted">{share.hasPassword ? t('share.oneTime') : t('share.passwordHint')}</span>
          </label>
          <Input value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} autoComplete="off" />
        </div>
        <div className="flex justify-end gap-2.5">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
