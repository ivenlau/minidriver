import { useEffect, useState } from 'react'
import { Globe, Languages, Monitor, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getThemePref, setThemePref, subscribeTheme } from '../lib/theme'
import type { ThemePref } from '../lib/theme'
import { LANGS, setLang } from '../i18n'
import type { LangCode } from '../i18n'
import { Dropdown } from './ui'

const THEME_ICON: Record<ThemePref, typeof Sun> = { light: Sun, dark: Moon, system: Monitor }

export function ThemeToggle() {
  const { t } = useTranslation()
  const [pref, setPref] = useState<ThemePref>(() => getThemePref())
  useEffect(() => subscribeTheme(() => setPref(getThemePref())), [])

  const Icon = THEME_ICON[pref]
  const next: ThemePref = pref === 'light' ? 'dark' : pref === 'dark' ? 'system' : 'light'
  const labelKey = { light: 'settings.themeLight', dark: 'settings.themeDark', system: 'settings.themeSystem' }[pref]

  return (
    <button
      onClick={() => setThemePref(next)}
      title={t(labelKey)}
      aria-label={t(labelKey)}
      className="cursor-pointer rounded-lg p-2 text-muted transition-colors hover:bg-surface2 hover:text-text"
    >
      <Icon size={18} />
    </button>
  )
}

export function ThemePicker() {
  const { t } = useTranslation()
  const [pref, setPref] = useState<ThemePref>(() => getThemePref())
  useEffect(() => subscribeTheme(() => setPref(getThemePref())), [])
  const options: { value: ThemePref; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: t('settings.themeLight'), icon: Sun },
    { value: 'dark', label: t('settings.themeDark'), icon: Moon },
    { value: 'system', label: t('settings.themeSystem'), icon: Monitor },
  ]
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          onClick={() => setThemePref(value)}
          className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border py-3.5 text-[13px] transition-colors ${
            pref === value ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line text-muted hover:bg-surface2'
          }`}
        >
          <Icon size={18} />
          {label}
        </button>
      ))}
    </div>
  )
}

export function LangToggle() {
  const { t, i18n } = useTranslation()
  return (
    <Dropdown
      trigger={
        <button
          title={t('settings.sectionLanguage')}
          aria-label={t('settings.sectionLanguage')}
          className="cursor-pointer rounded-lg p-2 text-muted transition-colors hover:bg-surface2 hover:text-text"
        >
          <Globe size={18} />
        </button>
      }
      items={LANGS.map((l) => ({
        label: l.label,
        icon: <Languages size={15} />,
        onSelect: () => setLang(l.code as LangCode),
      }))}
    />
  )
}

export function LangPicker() {
  const { i18n } = useTranslation()
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {LANGS.map((l) => (
        <button
          key={l.code}
          onClick={() => setLang(l.code)}
          className={`h-10 cursor-pointer rounded-xl border text-sm transition-colors ${
            i18n.language === l.code ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line text-muted hover:bg-surface2'
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}
