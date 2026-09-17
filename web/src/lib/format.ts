/** Intl 驱动的格式化（随语言切换） */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1) return '0 B'
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** i
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${UNITS[i]}`
}

export function formatRelative(ts: number, lang: string): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const diff = ts - Date.now()
  const abs = Math.abs(diff)
  const table: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 86400_000],
    ['month', 30 * 86400_000],
    ['week', 7 * 86400_000],
    ['day', 86400_000],
    ['hour', 3600_000],
    ['minute', 60_000],
  ]
  for (const [unit, ms] of table) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit)
  }
  return rtf.format(Math.round(diff / 1000), 'second')
}

export function formatDate(ts: number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts))
}

export function formatCount(n: number, lang: string): string {
  return new Intl.NumberFormat(lang).format(n)
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
