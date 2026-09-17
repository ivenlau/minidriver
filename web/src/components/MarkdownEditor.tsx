import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Bold, Code, Heading2, Italic, Link2, List, Quote } from 'lucide-react'
import type { NodeDto } from '../lib/types'
import { fileKind, isMarkdown } from './FileIcon'

/** 可编辑的文本上限（与服务端 PUT /content 一致） */
export const MAX_EDIT_BYTES = 1024 * 1024

export function canEdit(node: NodeDto): boolean {
  return node.type === 'file' && fileKind(node) === 'text' && (node.size ?? 0) <= MAX_EDIT_BYTES
}

type ToolAction = { icon: typeof Bold; label: string; run: () => void }

/**
 * 编辑面板：插入工具栏（仅 Markdown）+ 文本域。
 * 由 PreviewModal 在编辑模式下渲染，嵌在预览弹窗内部。
 */
export function TextEditorPane({
  node,
  text,
  onTextChange,
  loading,
}: {
  node: NodeDto
  text: string
  onTextChange: (t: string) => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const taRef = useRef<HTMLTextAreaElement>(null)
  const isMd = isMarkdown(node)

  const surround = (before: string, after: string = before) => {
    const el = taRef.current
    if (!el) return
    const s = el.selectionStart
    const e = el.selectionEnd
    const sel = text.slice(s, e)
    onTextChange(`${text.slice(0, s)}${before}${sel}${after}${text.slice(e)}`)
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
    onTextChange(text.slice(0, lineStart) + prefix + text.slice(lineStart))
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
    onTextChange(text.slice(0, s) + snippet + text.slice(e))
    requestAnimationFrame(() => {
      el.focus()
      const urlStart = s + sel.length + 3
      el.setSelectionRange(urlStart, urlStart + 8)
    })
  }

  const tools: ToolAction[] = [
    { icon: Bold, label: 'Bold', run: () => surround('**') },
    { icon: Italic, label: 'Italic', run: () => surround('*') },
    { icon: Heading2, label: 'Heading', run: () => prefixLine('## ') },
    { icon: List, label: 'List', run: () => prefixLine('- ') },
    { icon: Quote, label: 'Quote', run: () => prefixLine('> ') },
    { icon: Code, label: 'Code', run: () => surround('`') },
    { icon: Link2, label: 'Link', run: insertLink },
  ]

  return (
    <div className="flex min-h-0 flex-col">
      {isMd && (
        <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto pb-2">
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
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        readOnly={loading}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={loading ? t('common.loading') : ''}
        className="h-[46dvh] w-full resize-none bg-transparent p-3 font-mono text-[16px] leading-relaxed text-text outline-none md:h-[480px] md:text-[13.5px]"
      />
    </div>
  )
}
