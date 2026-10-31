'use client'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Search } from 'lucide-react'
import { request, useRealtime } from '../realtime'

type Hit = { id: string; title: string; snippet: string; secret: boolean }

// Busca Ctrl+K (W9): título e conteúdo; o servidor já filtra o que cada um pode ver.
export function SearchDialog() {
  const { socket, campaignId } = useRealtime()
  const router = useRouter()
  const t = useTranslations('wiki')
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') (e.preventDefault(), setOpen(true))
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { if (open) setTimeout(() => input.current?.focus()) }, [open])
  useEffect(() => {
    if (!q.trim()) return setHits([])
    const t = setTimeout(() => request<Hit[]>(socket, 'wiki:search', { q }).then((h) => (setHits(h), setSel(0))).catch(() => {}), 150)
    return () => clearTimeout(t)
  }, [q, socket])

  const go = (h: Hit) => { setOpen(false); setQ(''); router.push(`/c/${campaignId}/wiki/${h.id}`) }

  return (
    <>
      <button className="btn btn-ghost w-full justify-start text-muted" onClick={() => setOpen(true)}><Search size={14} /> {t('search')} <kbd className="ml-auto text-xs">Ctrl K</kbd></button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]" onClick={() => setOpen(false)}>
          <div role="dialog" aria-label={t('searchDialog')} className="card w-full max-w-lg overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPh')} aria-label={t('searchLabel')} className="w-full border-b border-line bg-transparent px-4 py-3 outline-none"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(s + 1, hits.length - 1)))
                if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)))
                if (e.key === 'Enter' && hits[sel]) go(hits[sel])
              }} />
            <ul role="listbox" className="max-h-80 overflow-y-auto">
              {hits.map((h, i) => (
                <li key={`${h.id}${i}`} role="option" aria-selected={i === sel}>
                  <button className={`w-full px-4 py-2 text-left ${i === sel ? 'bg-bg' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(h)}>
                    <div className="flex items-center gap-2 font-medium">{h.secret && <Lock size={12} className="text-accent" aria-label={t('inSecret')} />}{h.title}</div>
                    {h.snippet && <div className="truncate text-xs text-muted">{h.snippet}</div>}
                  </button>
                </li>
              ))}
              {q && !hits.length && <li className="px-4 py-3 text-sm text-muted">{t('nothing')}</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
