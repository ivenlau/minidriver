import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CheckCircle2, Info, XCircle } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'info'
type Toast = { id: number; kind: ToastKind; message: string }

const ToastCtx = createContext<(message: string, kind?: ToastKind) => void>(() => {})

export function useToast() {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++seq.current
    setToasts((t) => [...t.slice(-3), { id, kind, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 4200 : 2600)
  }, [])

  const value = useMemo(() => push, [push])

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="md-slide-up pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm shadow-pop"
          >
            {t.kind === 'success' && <CheckCircle2 size={17} className="shrink-0 text-accent" />}
            {t.kind === 'error' && <XCircle size={17} className="shrink-0 text-danger" />}
            {t.kind === 'info' && <Info size={17} className="shrink-0 text-muted" />}
            <span className="min-w-0 break-words">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
