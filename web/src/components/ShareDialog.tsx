import { useState } from 'react'
import { Check, Link2, Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import type { NodeDto } from '../lib/types'
import { Button, Input, Modal, cn } from './ui'

const EXPIRY_OPTIONS = [
  { value: 3600, key: 'exp1h' },
  { value: 86400, key: 'exp1d' },
  { value: 7 * 86400, key: 'exp7d' },
  { value: 30 * 86400, key: 'exp30d' },
]

/** 创建分享链接；完整链接只显示一次 */
export function ShareDialog({ node, onClose }: { node: NodeDto; onClose: () => void }) {
  const { t } = useTranslation()
  const [expiresIn, setExpiresIn] = useState(7 * 86400)
  const [password, setPassword] = useState('')
  const [maxDownloads, setMaxDownloads] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ url: string; expiresAt: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setCreating(true)
    setError(null)
    try {
      const res = await api.post<{ url: string; expiresAt: number }>('/api/shares', {
        nodeId: node.id,
        expiresIn,
        password: password || null,
        maxDownloads: maxDownloads ? parseInt(maxDownloads, 10) : null,
      })
      setCreated(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'UNKNOWN')
    } finally {
      setCreating(false)
    }
  }

  const copy = async () => {
    if (!created) return
    await navigator.clipboard.writeText(created.url).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal open onClose={onClose} title={created ? t('share.createdTitle') : t('share.createTitle', { name: node.name })}>
      {created ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-line bg-accent-soft px-3.5 py-3 text-[13px] leading-relaxed text-text">
            <Link2 size={16} className="mt-0.5 shrink-0 text-accent" />
            {t('share.createdHint')}
          </div>
          <div className="flex gap-2">
            <Input readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} />
            <Button variant="primary" onClick={copy} className="shrink-0">
              {copied ? <Check size={15} /> : null}
              {copied ? t('common.copied') : t('share.copyLink')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-[13px] font-medium text-text">{t('share.expiry')}</p>
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
            <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-text">
              <Lock size={13} className="text-muted" />
              {t('share.password')}
              <span className="font-normal text-muted">· {t('share.passwordHint')}</span>
            </label>
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              maxLength={128}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-text">
              {t('share.maxDownloads')}
              <span className="font-normal text-muted"> · {t('share.maxDownloadsHint')}</span>
            </label>
            <Input
              type="number"
              min={1}
              value={maxDownloads}
              onChange={(e) => setMaxDownloads(e.target.value.replace(/\D/g, ''))}
              placeholder="∞"
            />
          </div>
          {error && <p className="text-[13px] text-danger">{t(`errors.${error}`, { defaultValue: t('errors.UNKNOWN') })}</p>}
          <div className="flex justify-end gap-2.5 pt-1">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={create} disabled={creating}>
              {t('share.create')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
