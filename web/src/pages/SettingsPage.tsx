import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import {
  Copy,
  Fingerprint,
  HardDrive,
  KeyRound,
  Laptop,
  Palette,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react'
import { api } from '../lib/api'
import { useMe, useStorage } from '../state/auth'
import { registerPasskey } from '../lib/passkey'
import type { CredentialDto, SessionDto } from '../lib/types'
import { formatBytes, formatRelative } from '../lib/format'
import { LangPicker, ThemePicker } from '../components/ThemeLang'
import {
  Button,
  ConfirmDialog,
  Input,
  Modal,
  PromptDialog,
  cn,
} from '../components/ui'
import { useToast } from '../state/toast'

type Section = 'security' | 'appearance' | 'language' | 'storage'

export function SettingsPage() {
  const { t } = useTranslation()
  const [section, setSection] = useState<Section>('security')

  const tabs: { key: Section; label: string; icon: typeof ShieldCheck }[] = [
    { key: 'security', label: t('settings.sectionSecurity'), icon: ShieldCheck },
    { key: 'appearance', label: t('settings.sectionAppearance'), icon: Palette },
    { key: 'language', label: t('settings.sectionLanguage'), icon: KeyRound },
    { key: 'storage', label: t('settings.sectionStorage'), icon: HardDrive },
  ]

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 md:flex-row md:px-6">
      <nav className="flex gap-1 overflow-x-auto md:w-44 md:flex-col">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={cn(
              'flex shrink-0 cursor-pointer items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm transition-colors',
              section === key ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-surface2 hover:text-text',
            )}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        {section === 'security' && <SecuritySection />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'language' && <LanguageSection />}
        {section === 'storage' && <StorageSection />}
      </div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-surface p-5">
      <h2 className="mb-4 text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------- 安全

function SecuritySection() {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const { data: me } = useMe()

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['me'] })
    void qc.invalidateQueries({ queryKey: ['credentials'] })
    void qc.invalidateQueries({ queryKey: ['sessions'] })
  }

  const [addingPasskey, setAddingPasskey] = useState(false)
  const [renaming, setRenaming] = useState<CredentialDto | null>(null)
  const [deletingPasskey, setDeletingPasskey] = useState<CredentialDto | null>(null)
  const [revokingSession, setRevokingSession] = useState<SessionDto | null>(null)
  const [showRecovery, setShowRecovery] = useState<string[] | null>(null)

  const credentialsQuery = useQuery({
    queryKey: ['credentials'],
    queryFn: () => api.get<{ credentials: CredentialDto[] }>('/api/auth/credentials'),
  })
  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<{ sessions: SessionDto[] }>('/api/auth/sessions'),
  })

  const addPasskey = async (name: string) => {
    try {
      await registerPasskey(name)
      refresh()
      toast(t('settings.passkeyAdded'), 'success')
    } catch (err) {
      toast(t(`errors.${err instanceof Error && 'code' in err ? (err as { code: string }).code : 'UNKNOWN'}`), 'error')
    }
  }

  const errText = (err: unknown) =>
    t(`errors.${err instanceof Error && 'code' in err ? (err as { code: string }).code : 'UNKNOWN'}`)

  return (
    <div>
      <Card title={t('settings.passkeys')}>
        <p className="mb-4 text-[13px] leading-relaxed text-muted">{t('settings.passkeysHint')}</p>
        <div className="space-y-1">
          {(credentialsQuery.data?.credentials ?? []).map((cred) => (
            <div key={cred.id} className="group flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface2/60">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Fingerprint size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{cred.name}</p>
                <p className="text-[12px] text-muted">
                  {cred.lastUsedAt
                    ? t('settings.lastUsed', { time: formatRelative(cred.lastUsedAt, i18n.language) })
                    : t('settings.neverUsed')}
                  {' · '}
                  {cred.backedUp ? t('settings.backedUp') : t('settings.notBackedUp')}
                </p>
              </div>
              <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
                <Button variant="ghost" size="icon" title={t('common.rename')} onClick={() => setRenaming(cred)}>
                  <KeyRound size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-danger"
                  title={t('common.delete')}
                  onClick={() => setDeletingPasskey(cred)}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setAddingPasskey(true)}>
          <Plus size={15} />
          {t('settings.addPasskey')}
        </Button>
      </Card>

      <Card title={t('settings.sessions')}>
        <p className="mb-4 text-[13px] text-muted">{t('settings.sessionsHint')}</p>
        <div className="space-y-1">
          {(sessionsQuery.data?.sessions ?? []).map((session) => (
            <div key={session.id} className="group flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface2/60">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface2 text-muted">
                {/Mobile|Android|iPhone/i.test(session.user_agent ?? '') ? <Smartphone size={16} /> : <Laptop size={16} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">
                  {session.user_agent?.split(/[()]/)[1]?.trim() || session.user_agent?.slice(0, 40) || '—'}
                  {session.isCurrent && (
                    <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                      {t('settings.current')}
                    </span>
                  )}
                </p>
                <p className="text-[12px] text-muted">
                  {t('settings.lastUsed', { time: formatRelative(session.last_seen_at, i18n.language) })}
                  {session.ip_country ? ` · ${session.ip_country}` : ''}
                </p>
              </div>
              {!session.isCurrent && (
                <Button variant="ghost" size="icon" className="shrink-0 text-danger" onClick={() => setRevokingSession(session)}>
                  <Trash2 size={15} />
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <PasswordCard me={me} onChange={refresh} errText={errText} />
      <TotpCard me={me} onChange={refresh} errText={errText} />
      <RecoveryCard me={me} onChange={refresh} onGenerated={setShowRecovery} errText={errText} />

      <PromptDialog
        open={addingPasskey}
        title={t('settings.passkeyNamePrompt')}
        initialValue={defaultDeviceName()}
        confirmLabel={t('common.continue')}
        onClose={() => setAddingPasskey(false)}
        onConfirm={(name) => void addPasskey(name)}
      />
      {renaming && (
        <PromptDialog
          open
          title={t('settings.passkeyNamePrompt')}
          initialValue={renaming.name}
          confirmLabel={t('common.save')}
          onClose={() => setRenaming(null)}
          onConfirm={async (name) => {
            await api.patch(`/api/auth/credentials/${renaming.id}`, { name })
            refresh()
          }}
        />
      )}
      <ConfirmDialog
        open={!!deletingPasskey}
        title={t('common.delete')}
        message={deletingPasskey ? t('settings.deletePasskeyConfirm', { name: deletingPasskey.name }) : undefined}
        danger
        onClose={() => setDeletingPasskey(null)}
        onConfirm={async () => {
          if (!deletingPasskey) return
          try {
            await api.del(`/api/auth/credentials/${deletingPasskey.id}`)
            refresh()
          } catch (err) {
            toast(errText(err), 'error')
          }
        }}
      />
      <ConfirmDialog
        open={!!revokingSession}
        title={t('settings.signOut')}
        danger
        onClose={() => setRevokingSession(null)}
        onConfirm={async () => {
          if (!revokingSession) return
          await api.del(`/api/auth/sessions/${revokingSession.id}`)
          refresh()
        }}
      />
      <RecoveryCodesModal codes={showRecovery} onClose={() => setShowRecovery(null)} />
    </div>
  )
}

function defaultDeviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Mac/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Passkey'
}

function PasswordCard({
  me,
  onChange,
  errText,
}: {
  me: { hasPassword: boolean } | undefined
  onChange: () => void
  errText: (e: unknown) => string
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [mode, setMode] = useState<'view' | 'set'>('view')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')

  if (!me) return null
  const save = async () => {
    try {
      await api.put('/api/auth/password', { currentPassword: current, newPassword: next })
      setMode('view')
      setCurrent('')
      setNext('')
      onChange()
      toast(t('settings.saved'), 'success')
    } catch (err) {
      toast(errText(err), 'error')
    }
  }
  const disable = async () => {
    try {
      await api.del('/api/auth/password', { currentPassword: current })
      setMode('view')
      setCurrent('')
      onChange()
      toast(t('settings.passwordDisabled'), 'success')
    } catch (err) {
      toast(errText(err), 'error')
    }
  }

  return (
    <Card title={t('settings.passwordSection')}>
      {!me.hasPassword && mode === 'view' ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-muted">{t('settings.passwordOff')}</p>
          <Button size="sm" onClick={() => setMode('set')}>
            {t('settings.setPassword')}
          </Button>
        </div>
      ) : mode === 'view' ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-muted">••••••••</p>
          <Button size="sm" onClick={() => setMode('set')}>
            {t('settings.changePassword')}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          {me.hasPassword && (
            <Input type="password" placeholder={t('settings.currentPassword')} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          )}
          <Input type="password" placeholder={t('settings.newPassword')} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          <div className="flex justify-end gap-2">
            {me.hasPassword && (
              <Button type="button" variant="ghost" className="text-danger" onClick={() => void disable()}>
                {t('settings.disablePassword')}
              </Button>
            )}
            <Button type="button" onClick={() => setMode('view')}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={next.length < 8}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}

function TotpCard({
  me,
  onChange,
  errText,
}: {
  me: { totpEnabled: boolean } | undefined
  onChange: () => void
  errText: (e: unknown) => string
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string; qr: string } | null>(null)
  const [code, setCode] = useState('')
  const [disabling, setDisabling] = useState(false)
  const [disableCode, setDisableCode] = useState('')

  if (!me) return null

  const begin = async () => {
    try {
      const res = await api.post<{ secret: string; otpauthUri: string }>('/api/auth/totp/setup')
      const qr = await QRCode.toDataURL(res.otpauthUri, { margin: 1, width: 200 })
      setSetup({ ...res, qr })
    } catch (err) {
      toast(errText(err), 'error')
    }
  }
  const confirm = async () => {
    try {
      await api.post('/api/auth/totp/confirm', { code })
      setSetup(null)
      setCode('')
      onChange()
      toast(t('settings.totpEnabled'), 'success')
    } catch (err) {
      toast(errText(err), 'error')
    }
  }
  const disable = async () => {
    try {
      await api.del('/api/auth/totp', { code: disableCode })
      setDisabling(false)
      setDisableCode('')
      onChange()
      toast(t('settings.totpDisabled'), 'success')
    } catch (err) {
      toast(errText(err), 'error')
    }
  }

  return (
    <Card title={t('settings.totp')}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted">{me.totpEnabled ? t('settings.totpOn') : t('settings.totpOff')}</p>
        {me.totpEnabled ? (
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDisabling(true)}>
            {t('settings.disableTotp')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => void begin()}>
            {t('settings.enableTotp')}
          </Button>
        )}
      </div>

      {setup && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <p className="text-[13px] text-muted">{t('settings.scanHint')}</p>
          <div className="flex flex-col items-center gap-3">
            <img src={setup.qr} alt="TOTP QR" className="h-44 w-44 rounded-xl bg-white p-2" />
            <p className="text-[12px] text-muted">
              {t('settings.manualCode')}: <code className="rounded bg-surface2 px-1.5 py-0.5 text-[11px]">{setup.secret}</code>
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              inputMode="numeric"
              placeholder={t('settings.enterCode')}
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <Button variant="primary" onClick={() => void confirm()} disabled={code.length !== 6}>
              {t('settings.confirmCode')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={disabling}
        title={t('settings.disableTotp')}
        message={t('settings.disableTotpHint')}
        danger
        onClose={() => setDisabling(false)}
        onConfirm={() => void disable()}
      />
      {disabling && (
        <div className="fixed inset-x-4 top-1/3 z-50 mx-auto max-w-sm -translate-y-1/2">
          <Input inputMode="numeric" placeholder={t('settings.enterCode')} value={disableCode} onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))} />
        </div>
      )}
    </Card>
  )
}

function RecoveryCard({
  me,
  onChange,
  onGenerated,
  errText,
}: {
  me: { recoveryCodesLeft: number } | undefined
  onChange: () => void
  onGenerated: (codes: string[]) => void
  errText: (e: unknown) => string
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const generate = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/api/auth/recovery/regenerate'),
    onSuccess: (res) => {
      onChange()
      onGenerated(res.recoveryCodes)
    },
    onError: (err) => toast(errText(err), 'error'),
  })

  if (!me) return null
  return (
    <Card title={t('settings.recovery')}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          {t('settings.recoveryHint')} · {t('settings.recoveryLeft', { count: me.recoveryCodesLeft })}
        </p>
        <Button size="sm" onClick={() => setConfirming(true)}>
          <RefreshCw size={14} />
          {t('settings.regenerate')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={t('settings.regenerate')}
        message={t('settings.regenerateConfirm')}
        danger
        onClose={() => setConfirming(false)}
        onConfirm={() => generate.mutate()}
      />
    </Card>
  )
}

function RecoveryCodesModal({ codes, onClose }: { codes: string[] | null; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  if (!codes) return null
  const copyAll = async () => {
    await navigator.clipboard.writeText(codes.join('\n')).catch(() => {})
    toast(t('common.copied'), 'success')
  }
  return (
    <Modal open onClose={onClose} title={t('auth.recoveryTitle')}>
      <p className="mb-4 text-[13px] leading-relaxed text-muted">{t('auth.recoveryHint')}</p>
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface2 p-4 font-mono text-[13px] tracking-wider">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-warn">{t('settings.saveCodes')}</p>
      <div className="mt-4 flex justify-end gap-2.5">
        <Button onClick={copyAll}>
          <Copy size={14} />
          {t('auth.copyAll')}
        </Button>
        <Button variant="primary" onClick={onClose}>
          {t('settings.gotIt')}
        </Button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- 外观 / 语言 / 存储

function AppearanceSection() {
  const { t } = useTranslation()
  return (
    <Card title={t('settings.theme')}>
      <ThemePicker />
    </Card>
  )
}

function LanguageSection() {
  return (
    <Card title="Language / 语言">
      <LangPicker />
    </Card>
  )
}

function StorageSection() {
  const { t } = useTranslation()
  const { data } = useStorage()
  const QUOTA = 10 * 1024 * 1024 * 1024
  const used = data?.used ?? 0
  const pct = Math.min(100, (used / QUOTA) * 100)
  return (
    <Card title={t('settings.sectionStorage')}>
      <div className="space-y-4">
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[13px] text-muted">{t('settings.used')}</span>
            <span className="text-sm font-semibold">
              {formatBytes(used)} <span className="text-[12px] font-normal text-muted">/ {formatBytes(QUOTA)}</span>
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface2">
            <div
              className={cn('h-full rounded-full transition-all', pct > 90 ? 'bg-danger' : 'bg-accent')}
              style={{ width: `${Math.max(pct, 1.5)}%` }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Stat label={t('settings.filesCount', { count: data?.fileCount ?? 0 })} />
          <Stat label={t('settings.foldersCount', { count: data?.folderCount ?? 0 })} />
        </div>
        {data && data.trashCount > 0 && (
          <p className="text-[13px] text-muted">
            {t('settings.inTrash', { count: data.trashCount, size: formatBytes(data.trashBytes) })}
          </p>
        )}
      </div>
    </Card>
  )
}

function Stat({ label }: { label: string }) {
  return (
    <div className="rounded-xl bg-surface2 px-4 py-3">
      <p className="text-[13px] font-medium">{label}</p>
    </div>
  )
}
