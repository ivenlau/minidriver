import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui'

/** 底部批量操作栏（多选时出现），位置已适配底部任务栏安全区 */
export function BatchBar({ label, onClear, children }: { label: string; onClear: () => void; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="md-slide-up fixed inset-x-0 bottom-[calc(4rem_+_env(safe-area-inset-bottom)_+_0.5rem)] z-30 mx-auto flex w-fit max-w-[calc(100dvw-24px)] items-center gap-1.5 rounded-2xl border border-line bg-surface/95 px-2.5 py-2 shadow-pop backdrop-blur md:bottom-6">
      <span className="px-1.5 text-[13px] font-medium text-muted">{label}</span>
      {children}
      <div className="mx-1 h-5 w-px bg-line" />
      <Button variant="ghost" size="sm" onClick={onClear}>
        {t('common.clear')}
      </Button>
    </div>
  )
}
