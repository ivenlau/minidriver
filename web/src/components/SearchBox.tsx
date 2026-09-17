import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { api } from '../lib/api'
import type { NodeDto } from '../lib/types'
import { formatBytes } from '../lib/format'
import { FileIcon } from './FileIcon'

/** 顶栏搜索（防抖 + 结果下拉） */
export function SearchBox({ onOpenFile }: { onOpenFile: (node: NodeDto) => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<NodeDto[] | null>(null)
  const [focused, setFocused] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!q.trim()) {
      setResults(null)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<{ items: NodeDto[] }>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        setResults(res.items)
      } catch {
        setResults([])
      }
    }, 280)
    return () => clearTimeout(timer)
  }, [q])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const open = (node: NodeDto) => {
    setFocused(false)
    setQ('')
    setResults(null)
    if (node.type === 'folder') {
      navigate(`/files/${node.id}`)
    } else {
      onOpenFile(node)
    }
  }

  return (
    <div className="relative w-full max-w-md" ref={boxRef}>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder={t('files.searchPlaceholder')}
          className="h-9.5 w-full rounded-xl border border-transparent bg-surface2 pr-3.5 pl-10 text-sm text-text placeholder:text-muted/70 focus:border-accent focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>
      {focused && results !== null && (
        <div className="md-fade-in absolute inset-x-0 top-11 z-40 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface py-1.5 shadow-pop">
          {results.length === 0 ? (
            <p className="px-4 py-5 text-center text-[13px] text-muted">{t('files.searchEmpty')}</p>
          ) : (
            results.map((node) => (
              <button
                key={node.id}
                onClick={() => open(node)}
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-surface2"
              >
                <FileIcon node={node} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-text">{node.name}</p>
                  <p className="text-[11px] text-muted">
                    {node.type === 'folder'
                      ? t('files.items', { count: node.childCount ?? 0 })
                      : formatBytes(node.size)}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
