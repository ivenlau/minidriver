import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Cloud, Fingerprint, KeyRound } from 'lucide-react'
import { api } from '../lib/api'
import { useBootstrap } from '../state/auth'
import { browserSupportsWebAuthn, loginWithPasskey } from '../lib/passkey'
import { Button, Input, Spinner, cn } from '../components/ui'

type FallbackMode = 'none' | 'password' | 'totp' | 'recover'

export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const { data: bootstrap, isLoading } = useBootstrap()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<FallbackMode>('none')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [autofillActive, setAutofillActive] = useState(false)
  const started = useRef(false)

  const from = (location.state as { from?: string } | null)?.from ?? '/files'

  const done = () => {
    void qc.invalidateQueries({ queryKey: ['bootstrap'] })
    navigate(from, { replace: true })
  }

  const errText = (err: unknown) =>
    t(`errors.${err instanceof Error && 'code' in err ? (err as { code: string }).code : 'UNKNOWN'}`)

  // 条件 UI：输入框自动填充触发系统 Passkey 选择器
  useEffect(() => {
    if (started.current || !bootstrap?.initialized) return
    started.current = true
    if (!browserSupportsWebAuthn()) return
    setAutofillActive(true)
    loginWithPasskey(true)
      .then(done)
      .catch(() => setAutofillActive(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap?.initialized])

  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-bg">
        <Spinner size={24} />
      </div>
    )
  }
  if (bootstrap && !bootstrap.initialized) return <Navigate to="/setup" replace />

  const passkeyLogin = async () => {
    setBusy(true)
    setError(null)
    try {
      await loginWithPasskey(false)
      done()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const submitFallback = async () => {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'password') {
        const res = await api.post<{ needTotp?: boolean }>('/api/auth/password/login', { password })
        if (res.needTotp) {
          setMode('totp')
          setCode('')
          setBusy(false)
          return
        }
      } else if (mode === 'totp') {
        await api.post('/api/auth/totp/verify', { code })
      } else if (mode === 'recover') {
        await api.post('/api/auth/recover', { code })
      }
      done()
    } catch (err) {
      setError(errText(err))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-5 py-10">
      <div className="md-slide-up w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-white shadow-card">
            <Cloud size={26} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{t('auth.loginTitle')}</h1>
          <p className="mt-1.5 text-sm text-muted">{t('auth.loginSubtitle')}</p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <Button variant="primary" className="h-12 w-full text-[15px]" onClick={passkeyLogin} disabled={busy}>
            {busy ? <Spinner size={17} /> : <Fingerprint size={19} />}
            {t('auth.passkeyButton')}
          </Button>
          <p className="mt-3 text-center text-[12px] leading-relaxed text-muted">{t('auth.passkeyHint')}</p>

          {/* 条件 UI 的自动填充锚点输入框 */}
          {autofillActive && (
            <input
              type="text"
              name="username"
              autoComplete="username webauthn"
              aria-hidden="true"
              className="h-0 w-0 border-0 bg-transparent p-0 opacity-0"
              tabIndex={-1}
              onChange={() => {}}
            />
          )}

          {mode === 'none' ? (
            <button
              onClick={() => setMode(bootstrap?.authMethods.password ? 'password' : 'recover')}
              className="mx-auto mt-4 flex cursor-pointer items-center gap-1.5 text-[13px] text-muted hover:text-accent"
            >
              <KeyRound size={13} />
              {t('auth.usePassword')}
            </button>
          ) : (
            <form
              className="mt-5 space-y-3 border-t border-line pt-5"
              onSubmit={(e) => {
                e.preventDefault()
                void submitFallback()
              }}
            >
              {mode === 'password' && (
                <Input
                  type="password"
                  autoFocus
                  placeholder={t('auth.password')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              )}
              {(mode === 'totp' || mode === 'recover') && (
                <Input
                  autoFocus
                  inputMode={mode === 'totp' ? 'numeric' : 'text'}
                  placeholder={mode === 'totp' ? t('auth.totpCodeLabel') : t('auth.recoveryCodeLabel')}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
              {error && <p className="text-[13px] text-danger">{error}</p>}
              <div className={cn('flex gap-2', mode === 'totp' || mode === 'recover' ? 'justify-end' : 'justify-stretch')}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setMode('none')
                    setError(null)
                  }}
                >
                  {t('common.back')}
                </Button>
                <Button type="submit" variant="primary" disabled={busy || (mode === 'password' ? !password : !code)}>
                  {busy ? <Spinner size={15} /> : null}
                  {t('auth.verify')}
                </Button>
              </div>
              {/* 备用方式之间互相切换（否则启用密码后无法使用恢复码） */}
              <div className="flex justify-center gap-4 pt-1 text-[12px]">
                {mode !== 'recover' && (
                  <button
                    type="button"
                    className="cursor-pointer text-muted hover:text-accent"
                    onClick={() => {
                      setMode('recover')
                      setError(null)
                    }}
                  >
                    {t('auth.useRecovery')}
                  </button>
                )}
                {mode !== 'password' && bootstrap?.authMethods.password && (
                  <button
                    type="button"
                    className="cursor-pointer text-muted hover:text-accent"
                    onClick={() => {
                      setMode('password')
                      setError(null)
                    }}
                  >
                    {t('auth.usePasswordShort')}
                  </button>
                )}
              </div>
            </form>
          )}

          {mode === 'none' && error && <p className="mt-3 text-center text-[13px] text-danger">{error}</p>}
        </div>
      </div>
    </div>
  )
}
