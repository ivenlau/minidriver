import { useEffect, useState } from 'react'
import { Download, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { fetchTextPreview } from '../lib/api'
import type { NodeDto } from '../lib/types'
import { formatBytes } from '../lib/format'
import { Modal, Button, Spinner } from './ui'
import { fileKind } from './FileIcon'

/** 全屏文件预览：图片 / 视频 / 音频 / PDF / 文本 */
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
    const kind = fileKind(node)
    if (kind !== 'text') return
    setLoading(true)
    fetchTextPreview(node.id)
      .then(setText)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [node])

  if (!node) return null
  const kind = fileKind(node)
  const contentUrl = `/api/nodes/${node.id}/content`
  const downloadUrl = `${contentUrl}?dl=1`

  return (
    <Modal open onClose={onClose} wide title={node.name}>
      <div className="flex flex-col gap-4">
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
          {!failed && !loading && kind === 'text' && text !== null && (
            <pre className="max-h-[60dvh] w-full overflow-auto p-4 text-left text-[13px] leading-relaxed whitespace-pre-wrap text-text">
              {text}
            </pre>
          )}
          {!failed && !loading && kind === 'text' && text === null && <Spinner />}
          {(kind === 'other' || kind === 'archive' || kind === 'folder') && (
            <p className="p-8 text-sm text-muted">{t('preview.cannotPreview')}</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-muted">
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
      </div>
    </Modal>
  )
}
