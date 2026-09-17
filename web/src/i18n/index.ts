import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from './zh-CN.json'
import en from './en.json'

export const LANGS = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en', label: 'English' },
] as const

export type LangCode = (typeof LANGS)[number]['code']

const LANG_KEY = 'md.lang'
const CHANGE_EVENT = 'md-lang-change'

export function detectLang(): LangCode {
  const stored = localStorage.getItem(LANG_KEY)
  if (stored === 'zh-CN' || stored === 'en') return stored
  const nav = navigator.language.toLowerCase()
  return nav.startsWith('zh') ? 'zh-CN' : 'en'
}

export function setLang(lang: LangCode): void {
  localStorage.setItem(LANG_KEY, lang)
  void i18n.changeLanguage(lang)
  document.documentElement.lang = lang
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function subscribeLang(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb)
  return () => window.removeEventListener(CHANGE_EVENT, cb)
}

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en },
  },
  lng: detectLang(),
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
})
document.documentElement.lang = detectLang()

export default i18n
