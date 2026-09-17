import { useEffect, useState } from 'react'
import { Download, Pencil } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { fetchTextPreview } from '../lib/api'
import type { NodeDto } from '../lib/types'
import { formatBytes } from '../lib/format'
import { Modal, Button, Spinner } from './ui'
import { fileKind, isMarkdown } from './FileIcon'

/** 全屏文件预览：图片 / 视频 / 音频 / PDF / 文本（md 渲染，其余显示原文） */
export function PreviewModal({
  node,
  onClose,
  onEdit,
}: {
  node: NodeDto | null
  onClose: () => void
  onEdit?: (node: NodeDto) => void
}) {
  const { t, i18n } = useTranslation()
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setText(null)
    setFailed(false)
    if (!node) return
    if (fileKind(node) !== 'text') return
    setLoading(true)
    fetchTextPreview(node.id)
      .then(setText)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [node])

  if (!node) return null
  const kind = fileKind(node)
  const md = isMarkdown(node)
  const contentUrl = `/api/nodes/${node.id}/content`
  const downloadUrl = `${contentUrl}?dl=1`

  return (
    <Modal open onClose={onClose} wide pinnedFooter title={node.name}>
      {/* 内容区：弹窗高度随内容自适应，超出上限时仅这里滚动 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 sm:px-6">
        {/* 文本类：全宽正常排版（md 渲染 / 其余原文左对齐），不做居中灰盒 */}
        {kind === 'text' ? (
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
      {/* 底栏：始终钉在底部 */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        <span className="min-w-0 truncate text-[13px] text-muted">
          {formatBytes(node.size)} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(node.updatedAt))}
        </span>
        <div className="flex shrink-0 gap-2">
          {onEdit && kind === 'text' && (
            <Button size="sm" onClick={() => onEdit(node)}>
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
      </div>
    </Modal>
  )
}
