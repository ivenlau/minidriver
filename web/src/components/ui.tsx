import { useEffect, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------- Button

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accentSoft'
  size?: 'sm' | 'md' | 'icon'
}

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonProps) {
  const variants: Record<string, string> = {
    primary: 'bg-accent text-white hover:bg-accent-strong active:opacity-90 shadow-card',
    secondary: 'bg-surface text-text border border-line hover:bg-surface2',
    ghost: 'text-muted hover:bg-surface2 hover:text-text',
    danger: 'bg-danger text-white hover:opacity-90',
    accentSoft: 'bg-accent-soft text-accent hover:brightness-95',
  }
  const sizes: Record<string, string> = {
    sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
    md: 'h-10 px-4 text-sm gap-2 rounded-xl',
    icon: 'h-9 w-9 rounded-lg justify-center',
  }
  return (
    <button
      className={cn(
        'inline-flex cursor-pointer items-center font-medium transition-colors duration-150 select-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    />
  )
}

// ---------------------------------------------------------------- Input

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-text placeholder:text-muted/70',
        'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25',
        className,
      )}
      {...rest}
    />
  )
}

// ---------------------------------------------------------------- Modal（桌面居中对话框 / 移动端底部 sheet）

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div
      className="md-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'md-sheet-up sm:md-slide-up flex max-h-[88dvh] w-full flex-col overflow-hidden border border-line bg-surface shadow-pop',
          'rounded-t-3xl sm:rounded-2xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2 sm:px-6">
          <div className="mx-auto h-1 w-10 rounded-full bg-surface3 sm:hidden" />
        </div>
        {title && (
          <div className="flex items-start justify-between gap-3 px-5 pb-3 sm:px-6">
            <h2 className="text-base font-semibold text-text sm:text-lg">{title}</h2>
            <button
              onClick={onClose}
              className="-mr-1 -mt-1 cursor-pointer rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-text"
              aria-label="close"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-6 sm:pb-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------- Dropdown 菜单

export type MenuItem = {
  label: string
  icon?: ReactNode
  danger?: boolean
  onSelect: () => void
  hidden?: boolean
}

export function Dropdown({
  trigger,
  items,
  align = 'right',
}: {
  trigger: ReactNode
  items: MenuItem[]
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <div
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        {trigger}
      </div>
      {open && (
        <div
          className={cn(
            'md-fade-in absolute z-40 mt-1.5 min-w-44 overflow-hidden rounded-xl border border-line bg-surface py-1.5 shadow-pop',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items
            .filter((i) => !i.hidden)
            .map((item, idx) => (
              <button
                key={idx}
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                  item.onSelect()
                }}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2 text-left text-sm hover:bg-surface2',
                  item.danger ? 'text-danger' : 'text-text',
                )}
              >
                {item.icon && <span className="shrink-0 opacity-80">{item.icon}</span>}
                {item.label}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 对话框工具

export function ConfirmDialog({
  open,
  title,
  message,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {message && <p className="pb-5 text-sm leading-relaxed text-muted">{message}</p>}
      <div className="flex justify-end gap-2.5">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          onClick={() => {
            onConfirm()
            onClose()
          }}
        >
          {t('common.confirm')}
        </Button>
      </div>
    </Modal>
  )
}

export function PromptDialog({
  open,
  title,
  label,
  initialValue = '',
  placeholder,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  label?: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  onConfirm: (value: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initialValue)
  const inputId = useId()
  useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) {
            onConfirm(value.trim())
            onClose()
          }
        }}
      >
        <label htmlFor={inputId} className="mb-1.5 block text-[13px] text-muted">
          {label}
        </label>
        <Input
          id={inputId}
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="mt-5 flex justify-end gap-2.5">
          <Button type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!value.trim()}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------- 其他

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-muted" />
}

export function Splash() {
  return (
    <div className="flex h-dvh items-center justify-center bg-bg">
      <Spinner size={26} />
    </div>
  )
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center md:py-28">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        {icon}
      </div>
      <p className="text-[15px] font-medium text-text">{title}</p>
      {hint && <p className="mt-1.5 max-w-xs text-sm text-muted">{hint}</p>}
    </div>
  )
}

export function SkeletonList({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-1 p-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
          <div className="md-skeleton h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <div className="md-skeleton h-3.5 w-1/3 rounded" />
            <div className="md-skeleton h-3 w-1/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}
