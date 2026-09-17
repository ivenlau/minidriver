import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Pencil } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { api, fetchTextPreview } from '../lib/api'
import type { NodeDto } from '../lib/types'
import { formatBytes } from '../lib/format'
import { Modal, Button, ConfirmDialog, Spinner } from './ui'
import { fileKind, isMarkdown } from './FileIcon'
import { TextEditorPane } from './MarkdownEditor'
import { useToast } from '../state/toast'

/**
 * 文件预览弹窗（底部弹出，高度随内容自适应，底栏钉底）。
 * 点「编辑」就地切换为编辑模式：同一个弹窗、同一个位置，底栏变为 取消/保存。
 */
export function PreviewModal({
  node,
  onClose,
  startInEdit,
}: {
  node: NodeDto | null
  onClose: () => void
  startInEdit?: boolean
}) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const [text, setText] = useState<string | null>(null)
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const dirty = editing && text !== null && text !== original

  // node 变化（含以编辑模式打开）时重置并加载
  useEffect(() => {
    setText(null)
    setOriginal('')
    setFailed(false)
    setEditing(!!startInEdit)
    if (!node) return
    if (fileKind(node) !== 'text') return
    setLoading(true)
    fetchTextPreview(node.id)
      .then((content) => {
        setText(content)
        setOriginal(content)
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [node, startInEdit])

  // 编辑中有未保存修改时拦截刷新/关闭
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const save = useCallback(async () => {
    if (!node || saving || text === null || text === original) return
    setSaving(true)
    try {
      await api.send('PUT', `/api/nodes/${node.id}/content`, new TextEncoder().encode(text))
      setOriginal(text)
      for (const key of ['nodes', 'recent', 'starred']) {
        void qc.invalidateQueries({ queryKey: [key] })
      }
      toast(t('editor.saved'), 'success')
    } catch (err) {
      toast(t(`errors.${err instanceof Error && 'code' in err ? (err as { code: string }).code : 'UNKNOWN'}`), 'error')
    } finally {
      setSaving(false)
    }
  }, [node, original, qc, saving, t, text, toast])

  // 编辑模式下 Ctrl/Cmd+S 保存
  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editing, save])

  if (!node) return null
  const kind = fileKind(node)
  const md = isMarkdown(node)
  const contentUrl = `/api/nodes/${node.id}/content`
  const downloadUrl = `${contentUrl}?dl=1`

  const cancelEdit = () => (dirty ? setConfirmDiscard(true) : setEditing(false))

  return (
    <Modal open onClose={onClose} wide pinnedFooter title={node.name}>
      {/* 内容区：弹窗高度随内容自适应，超出上限时仅这里滚动 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 sm:px-6">
        {editing && kind === 'text' && text !== null ? (
          <TextEditorPane node={node} text={text} onTextChange={setText} loading={loading} />
        ) : kind === 'text' ? (
          <div className="overflow-hidden">
            {failed && <p className="p-8 text-sm text-muted">{t('preview.loadFailed')}</p>}
            {loading && (
              <div className="flex w-full justify-center p-8">
                <Spinner size={22} />
              </div>
            )}
            {!failed && !loading && md && (
              <article className="prose prose-sm dark:prose-invert max-w-none md:prose-base">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{ a: ({ node: n, ...rest }) => <a {...rest} target="_blank" rel="noreferrer" /> }}
                >
                  {text ?? ''}
                </ReactMarkdown>
              </article>
            )}
            {!failed && !loading && !md && (
              <pre className="text-left font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words text-text">
                {text ?? ''}
              </pre>
            )}
          </div>
        ) : (
          <div className="flex min-h-40 items-center justify-center overflow-hidden rounded-xl bg-surface2 md:min-h-72">
            {failed && <p className="p-8 text-sm text-muted">{t('preview.loadFailed')}</p>}
            {!failed && loading && <Spinner size={24} />}
            {!failed && !loading && kind === 'image' && (
              <img src={contentUrl} alt={node.name} className="max-h-[60dvh] w-auto max-w-full object-contain" />
            )}
            {!failed && !loading && kind === 'video' && (
              <video src={contentUrl} controls autoPlay className="max-h-[60dvh] w-full" />
            )}
            {!failed && !loading && kind === 'audio' && (
              <div className="w-full max-w-md p-6">
                <audio src={contentUrl} controls autoPlay className="w-full" />
              </div>
            )}
            {!failed && !loading && kind === 'pdf' && (
              <iframe src={contentUrl} title={node.name} className="h-[60dvh] w-full rounded-xl border-0 bg-white" />
            )}
            {(kind === 'other' || kind === 'archive' || kind === 'folder') && (
              <p className="p-8 text-sm text-muted">{t('preview.cannotPreview')}</p>
            )}
          </div>
        )}
      </div>
      {/* 底栏：预览态 = 信息+编辑+下载；编辑态 = 取消+保存 */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        {editing ? (
          <>
            <span className="min-w-0 truncate text-[13px] text-muted">
              {dirty && <span className="text-accent">● </span>}
              {node.name}
            </span>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={cancelEdit} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={() => void save()} disabled={!dirty || saving}>
                {saving ? <Spinner size={14} /> : null}
                {t('editor.save')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="min-w-0 truncate text-[13px] text-muted">
              {formatBytes(node.size)} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(node.updatedAt))}
            </span>
            <div className="flex shrink-0 gap-2">
              {kind === 'text' && canEditText(node) && (
                <Button size="sm" onClick={() => setEditing(true)}>
                  <Pencil size={15} />
                  {t('files.edit')}
                </Button>
              )}
              <a href={downloadUrl} className="inline-flex">
                <Button variant="primary" size="sm">
                  <Download size={15} />
                  {t('common.download')}
                </Button>
              </a>
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmDiscard}
        title={t('editor.unsavedTitle')}
        message={t('editor.unsavedMessage')}
        danger
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setText(original)
          setEditing(false)
        }}
      />
    </Modal>
  )
}

function canEditText(node: NodeDto): boolean {
  return (node.size ?? 0) <= 1024 * 1024
}
