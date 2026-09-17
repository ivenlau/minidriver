import { cn } from './ui'

/** MiniDriver 品牌标识：靛蓝圆角方块 + 实心云朵（与 favicon / PWA 图标同源） */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={cn('shrink-0', className)} aria-hidden>
      <rect width="64" height="64" rx="16" fill="var(--md-accent)" />
      <path
        d="M45.8 48.8H25.4a16.8 16.8 0 1 1 16.104-21.6h4.296a10.8 10.8 0 1 1 0 21.6Z"
        fill="#fff"
        opacity="0.95"
      />
    </svg>
  )
}
