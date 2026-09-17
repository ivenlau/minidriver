/** 主题三态：亮 / 暗 / 跟随系统（与 public/theme.js 保持一致） */
export type ThemePref = 'light' | 'dark' | 'system'

const KEY = 'md.theme'
const CHANGE_EVENT = 'md-theme-change'

const media = window.matchMedia('(prefers-color-scheme: dark)')

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

export function applyTheme(pref: ThemePref): void {
  const dark = pref === 'dark' || (pref === 'system' && media.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export function setThemePref(pref: ThemePref): void {
  localStorage.setItem(KEY, pref)
  applyTheme(pref)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function subscribeTheme(cb: () => void): () => void {
  const onChange = () => cb()
  window.addEventListener(CHANGE_EVENT, onChange)
  media.addEventListener('change', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    media.removeEventListener('change', onChange)
  }
}
