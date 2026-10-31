'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Trash2 } from 'lucide-react'
import { request, useRealtime, useSocketEvent } from '../realtime'
import { useWiki } from './context'

type Ev = { id: string; date: string; sortKey: number; title: string; linkPageId: string | null }

// Linha do tempo (W11): datas do calendário do mundo como texto livre; a ordem vem de um número (ano, dia…).
export function TimelinePage({ pageId, canEdit }: { pageId: string; canEdit: boolean }) {
  const { socket, campaignId } = useRealtime()
  const { pages, byId } = useWiki()
  const [events, setEvents] = useState<Ev[]>([])
  const [error, setError] = useState('')
  const load = useCallback(() => { request<Ev[]>(socket, 'timeline:list', { pageId }).then(setEvents).catch((e) => setError(e.message)) }, [socket, pageId])
  useEffect(load, [load])
  useSocketEvent<{ pageId: string }>('timeline:changed', useCallback((m) => m.pageId === pageId && load(), [pageId, load]))
  const save = (ev: Partial<Ev>) => request(socket, 'timeline:upsert', { pageId, ...ev }).catch((e) => setError(e.message))

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="text-sm text-fumble">{error}</p>}
      {canEdit && (
        <form className="card grid grid-cols-[1fr_6rem_2fr_1fr_auto] gap-2 p-3" onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          save({ date: String(f.get('date')), sortKey: Number(f.get('sortKey')) || 0, title: String(f.get('title')), linkPageId: String(f.get('link')) || null })
          e.currentTarget.reset()
        }}>
          <input name="date" required placeholder="Data (ex.: 3ª Lua de 1204)" aria-label="Data" className="input" />
          <input name="sortKey" type="number" step="any" placeholder="Ordem" aria-label="Ordem (ex.: ano)" className="input" />
          <input name="title" required placeholder="O que aconteceu" aria-label="Evento" className="input" />
          <select name="link" aria-label="Página ligada" className="input"><option value="">Sem página</option>{pages.filter((p) => p.id !== pageId).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
          <button className="btn btn-primary">Adicionar</button>
        </form>
      )}
      <ol className="relative space-y-4 border-l-2 border-accent/40 pl-6">
        {events.map((ev) => {
          const linked = ev.linkPageId ? byId.get(ev.linkPageId) : null
          return (
            <li key={ev.id} className="group relative">
              <span className="absolute top-1.5 -left-[1.95rem] size-3 rounded-full border-2 border-accent bg-bg" />
              <div className="text-xs font-medium tracking-wide text-accent uppercase">{ev.date}</div>
              <div className="flex items-start gap-2">
                <span className="flex-1">{ev.title}{linked && <> · <Link className="text-accent hover:underline" href={`/c/${campaignId}/wiki/${linked.id}`}>{linked.title}</Link></>}</span>
                {canEdit && <button aria-label={`Apagar ${ev.title}`} className="hidden text-muted group-hover:block hover:text-fumble" onClick={() => request(socket, 'timeline:delete', { pageId, id: ev.id })}><Trash2 size={14} /></button>}
              </div>
            </li>
          )
        })}
        {!events.length && <li className="text-muted">Nenhum evento ainda.</li>}
      </ol>
    </div>
  )
}
