import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Cloud, Download, LinkIcon, Lock } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import type { ShareMeta } from '../lib/types'
import { formatBytes, formatRelative } from '../lib/format'
import { Button, Input, Spinner } from '../components/ui'
import { fileKind } from '../components/FileIcon'

/** 公开分享页（无登录）：预览 + 下载，密码门控 */
export function ShareViewPage() {
  const { token } = useParams()
  const { t, i18n } = useTranslation()

  const [meta, setMeta] = useState<ShareMeta | null>(null)
  const [needPassword, setNeedPassword] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [loading, setLoading] = useState(true)
  const [password, setPassword] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState<string | null>(null)

  const loadMeta = async () => {
    setLoading(true)
    setInvalid(false)
    try {
      const res = await api.get<ShareMeta>(`/api/s/${token}/meta`)
      setMeta(res)
      setNeedPassword(res.needPassword)
      document.title = res.name ? `${res.name} · MiniDriver` : 'MiniDriver'
    } catch {
      setInvalid(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMeta()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // 文本预览
  useEffect(() => {
    setText(null)
    if (!meta || needPassword || !meta.previewable) return
    const mime = meta.mime ?? ''
    if (!(mime.startsWith('text/') || mime === 'application/json')) return
    fetch(`/api/s/${token}/content`, { headers: { range: 'bytes=0-1048575' } })
      .then((r) => (r.ok || r.status === 206 ? r.text() : ''))
      .then(setText)
      .catch(() => setText(''))
  }, [meta, needPassword, token])

  const unlock = async () => {
    setBusy(true)
    setPwError(null)
    try {
      const res = await api.post<{ ok: boolean; meta?: ShareMeta }>(`/api/s/${token}/unlock`, { password })
      if (res.meta) {
        setMeta(res.meta)
        setNeedPassword(false)
      } else {
        await loadMeta()
      }
    } catch (err) {
      setPwError(err instanceof ApiError ? err.code : 'UNKNOWN')
    } finally {
      setBusy(false)
    }
  }

  const kind = meta?.mime ? fileKind({ type: 'file', mime: meta.mime, name: meta.name ?? '' }) : 'other'
  const contentUrl = `/api/s/${token}/content`
  const previewable = meta?.previewable && !needPassword

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-line bg-surface px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white">
          <Cloud size={15} />
        </div>
        <span className="text-sm font-semibold">{t('common.appName')}</span>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-8 md:items-center">
        {loading ? (
          <Spinner size={24} />
        ) : invalid ? (
          <div className="md-slide-up flex max-w-sm flex-col items-center rounded-2xl border border-line bg-surface px-8 py-10 text-center shadow-card">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface2 text-muted">
              <LinkIcon size={24} />
            </div>
            <p className="text-[15px] font-medium">{t('shareView.linkInvalid')}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t('shareView.linkInvalidHint')}</p>
          </div>
        ) : needPassword ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void unlock()
            }}
            className="md-slide-up w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center shadow-card"
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Lock size={24} />
            </div>
            <p className="text-[15px] font-medium">{t('shareView.protected')}</p>
            <p className="mt-1.5 text-[13px] text-muted">{t('shareView.passwordPrompt')}</p>
            <Input
              type="password"
              className="mt-5"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {pwError && (
              <p className="mt-2 text-[13px] text-danger">
                {t(`errors.${pwError === 'SHARE_PASSWORD_INVALID' ? 'SHARE_PASSWORD_INVALID' : 'UNKNOWN'}`)}
              </p>
            )}
            <Button type="submit" variant="primary" className="mt-4 w-full" disabled={busy || !password}>
              {busy ? <Spinner size={15} /> : null}
              {t('shareView.unlock')}
            </Button>
          </form>
        ) : meta ? (
          <div className="md-slide-up w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            {/* 预览区 */}
            <div className="flex min-h-56 items-center justify-center bg-surface2 md:min-h-80">
              {!previewable ? (
                <div className="flex flex-col items-center gap-2 p-8 text-muted">
                  <Cloud size={32} className="opacity-50" />
                  <p className="text-[13px]">{t('shareView.previewUnavailable')}</p>
                </div>
              ) : kind === 'image' ? (
                <img src={contentUrl} alt={meta.name ?? ''} className="max-h-[55dvh] w-auto max-w-full object-contain" />
              ) : kind === 'video' ? (
                <video src={contentUrl} controls autoPlay className="max-h-[55dvh] w-full" />
              ) : kind === 'audio' ? (
                <div className="w-full max-w-md p-6">
                  <audio src={contentUrl} controls autoPlay className="w-full" />
                </div>
              ) : kind === 'pdf' ? (
                <iframe src={contentUrl} title={meta.name ?? ''} className="h-[55dvh] w-full border-0 bg-white" />
              ) : kind === 'text' ? (
                <pre className="max-h-[55dvh] w-full overflow-auto p-5 text-left text-[13px] leading-relaxed whitespace-pre-wrap">
                  {text ?? t('common.loading')}
                </pre>
              ) : null}
            </div>

            {/* 信息 + 下载 */}
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{meta.name}</p>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  {formatBytes(meta.size ?? null)}
                  {meta.expiresAt ? ` · ${t('shareView.expiresOn', { time: formatRelative(meta.expiresAt, i18n.language) })}` : ''}
                </p>
              </div>
              <a href={`${contentUrl}?dl=1`} className="shrink-0">
                <Button variant="primary" className="w-full sm:w-auto">
                  <Download size={16} />
                  {t('shareView.download')}
                </Button>
              </a>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}
