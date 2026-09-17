import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Bold,
  Code,
  Heading2,
  Italic,
  Link2,
  List,
  Quote,
  Save,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../lib/api'
import type { NodeDto } from '../lib/types'
import { fileKind } from './FileIcon'
import { Button, ConfirmDialog, Spinner, cn } from './ui'
import { useToast } from '../state/toast'

/** 可编辑的文本上限（与服务端 PUT /content 一致） */
export const MAX_EDIT_BYTES = 1024 * 1024

export function canEdit(node: NodeDto): boolean {
  return node.type === 'file' && fileKind(node) === 'text' && (node.size ?? 0) <= MAX_EDIT_BYTES
}

type ToolAction = { icon: typeof Bold; label: string; run: () => void }

/** 全屏 Markdown/TXT 编辑器：桌面分屏实时预览，移动端「编辑|预览」切换 */
export function MarkdownEditor({ node, onClose }: { node: NodeDto; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const taRef = useRef<HTMLTextAreaElement>(null)

  const [text, setText] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [previewSrc, setPreviewSrc] = useState('')
  const [confirmLeave, setConfirmLeave] = useState(false)

  const dirty = text !== original

  // 加载内容
  useEffect(() => {
    let alive = true
    fetch(`/api/nodes/${node.id}/content`, { credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok && r.status !== 206) throw new Error(String(r.status))
        return r.text()
      })
      .then((content) => {
        if (!alive) return
        setText(content)
        setOriginal(content)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        toast(t('editor.loadFailed'), 'error')
        onClose()
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  // 预览防抖
  useEffect(() => {
    const timer = setTimeout(() => setPreviewSrc(text), 200)
    return () => clearTimeout(timer)
  }, [text])

  // 未保存时拦截刷新/关闭
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const save = useCallback(async () => {
    if (saving || !dirty) return
    setSaving(true)
    try {
      await api.send('PUT', `/api/nodes/${node.id}/content`, new TextEncoder().encode(text))
      setOriginal(text)
      for (const key of ['nodes', 'recent', 'starred']) {
        void qc.invalidateQueries({ queryKey: [key] })
      }
      toast(t('common.ok'), 'success')
    } catch (err) {
      toast(t(`errors.${err instanceof Error && 'code' in err ? (err as { code: string }).code : 'UNKNOWN'}`), 'error')
    } finally {
      setSaving(false)
    }
  }, [dirty, node.id, qc, saving, t, text, toast])

  // Ctrl/Cmd+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [save])

  const requestClose = () => (dirty ? setConfirmLeave(true) : onClose())

  // ---- 工具栏插入（保持光标与选区） ----
  const surround = (before: string, after: string = before) => {
    const el = taRef.current
    if (!el) return
    const s = el.selectionStart
    const e = el.selectionEnd
    const sel = text.slice(s, e)
    setText(`${text.slice(0, s)}${before}${sel}${after}${text.slice(e)}`)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(s + before.length, s + before.length + sel.length)
    })
  }
  const prefixLine = (prefix: string) => {
    const el = taRef.current
    if (!el) return
    const s = el.selectionStart
    const lineStart = text.lastIndexOf('\n', s - 1) + 1
    setText(text.slice(0, lineStart) + prefix + text.slice(lineStart))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(s + prefix.length, s + prefix.length)
    })
  }
  const insertLink = () => {
    const el = taRef.current
    if (!el) return
    const s = el.selectionStart
    const e = el.selectionEnd
    const sel = text.slice(s, e) || 'text'
    const snippet = `[${sel}](https://)`
    setText(text.slice(0, s) + snippet + text.slice(e))
    requestAnimationFrame(() => {
      el.focus()
      const urlStart = s + sel.length + 3
      el.setSelectionRange(urlStart, urlStart + 8)
    })
  }

  const tools: ToolAction[] = useMemo(
    () => [
      { icon: Bold, label: 'Bold', run: () => surround('**') },
      { icon: Italic, label: 'Italic', run: () => surround('*') },
      { icon: Heading2, label: 'Heading', run: () => prefixLine('## ') },
      { icon: List, label: 'List', run: () => prefixLine('- ') },
      { icon: Quote, label: 'Quote', run: () => prefixLine('> ') },
      { icon: Code, label: 'Code', run: () => surround('`') },
      { icon: Link2, label: 'Link', run: insertLink },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text],
  )

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      {/* 顶栏 */}
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:px-5">
        <button
          onClick={requestClose}
          className="cursor-pointer rounded-lg p-2 text-muted hover:bg-surface2 hover:text-text"
          aria-label={t('common.back')}
        >
          <ArrowLeft size={18} />
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {node.name}
          {dirty && <span className="ml-1 text-accent">●</span>}
        </p>
        {/* 移动端 编辑|预览 切换 */}
        <div className="flex rounded-lg bg-surface2 p-0.5 md:hidden">
          {(['edit', 'preview'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] transition-colors',
                view === v ? 'bg-surface font-medium text-accent shadow-card' : 'text-muted',
              )}
            >
              {t(`editor.${v}`)}
            </button>
          ))}
        </div>
        <span className="hidden text-[11px] text-muted md:inline">{t('editor.saveHint')}</span>
        <Button variant="primary" size="sm" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? <Spinner size={14} /> : <Save size={15} />}
          {t('editor.save')}
        </Button>
      </header>

      {/* 插入工具栏 */}
      {view !== 'preview' && (
        <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-2 py-1">
          {tools.map(({ icon: Icon, label, run }) => (
            <button
              key={label}
              title={label}
              onClick={run}
              className="shrink-0 cursor-pointer rounded-lg p-2 text-muted hover:bg-surface2 hover:text-text"
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
      )}

      {/* 内容区：桌面分屏 / 移动端单 pane 切换 */}
      <div className="flex min-h-0 flex-1">
        <div className={cn('min-w-0 flex-1', view === 'preview' && 'hidden md:block')}>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={loading}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={loading ? t('common.loading') : ''}
            className="h-full w-full resize-none bg-bg p-4 font-mono text-[16px] leading-relaxed text-text outline-none md:text-[13.5px]"
          />
        </div>
        <div
          className={cn(
            'min-w-0 flex-1 overflow-y-auto border-line md:border-l',
            view === 'edit' && 'hidden md:block',
          )}
        >
          <article className="prose prose-sm dark:prose-invert max-w-none p-4 md:prose-base">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ node, ...rest }) => <a {...rest} target="_blank" rel="noreferrer" />,
              }}
            >
              {previewSrc}
            </ReactMarkdown>
          </article>
        </div>
      </div>

      <ConfirmDialog
        open={confirmLeave}
        title={t('editor.unsavedTitle')}
        message={t('editor.unsavedMessage')}
        danger
        onClose={() => setConfirmLeave(false)}
        onConfirm={onClose}
      />
    </div>
  )
}
