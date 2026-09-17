import { FileArchive, FileText, File, Film, Folder, Image as ImageIcon, Music } from 'lucide-react'
import type { NodeDto } from '../lib/types'

export type FileKind = 'folder' | 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'archive' | 'other'

export function fileKind(node: Pick<NodeDto, 'type' | 'mime' | 'name'>): FileKind {
  if (node.type === 'folder') return 'folder'
  const mime = node.mime ?? ''
  const ext = node.name.split('.').pop()?.toLowerCase() ?? ''
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('text/') || mime === 'application/json') return 'text'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive'
  return 'other'
}

const KIND_STYLE: Record<FileKind, { icon: typeof File; className: string }> = {
  folder: { icon: Folder, className: 'text-accent bg-accent-soft' },
  image: { icon: ImageIcon, className: 'text-violet-500 bg-violet-500/10' },
  video: { icon: Film, className: 'text-rose-500 bg-rose-500/10' },
  audio: { icon: Music, className: 'text-amber-500 bg-amber-500/10' },
  pdf: { icon: FileText, className: 'text-red-500 bg-red-500/10' },
  text: { icon: FileText, className: 'text-sky-500 bg-sky-500/10' },
  archive: { icon: FileArchive, className: 'text-orange-500 bg-orange-500/10' },
  other: { icon: File, className: 'text-muted bg-surface2' },
}

/** 列表/网格中的文件图标或缩略图 */
export function FileIcon({ node, size = 'md' }: { node: NodeDto; size?: 'sm' | 'md' | 'lg' }) {
  const kind = fileKind(node)
  const dims = size === 'sm' ? 'h-9 w-9 rounded-lg' : size === 'lg' ? 'h-14 w-14 rounded-xl' : 'h-10 w-10 rounded-xl'
  const iconSize = size === 'sm' ? 17 : size === 'lg' ? 26 : 20

  if (node.hasThumb) {
    return (
      <div className={`${dims} shrink-0 overflow-hidden bg-surface2`}>
        <img
          src={`/api/nodes/${node.id}/thumb`}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
            e.currentTarget.parentElement?.classList.add(...KIND_STYLE[kind].className.split(' '))
          }}
        />
      </div>
    )
  }

  const { icon: Icon, className } = KIND_STYLE[kind]
  return (
    <div className={`${dims} flex shrink-0 items-center justify-center ${className}`}>
      <Icon size={iconSize} />
    </div>
  )
}
