'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic'
import { EyeOff, Trash2, X } from 'lucide-react'
import { upload } from '@/lib/upload'

export type Pin = {
  id: string; x: number; y: number; icon: string | null; imageAssetId: string | null; label: string | null
  note: { text: string; color?: string; size?: number; round?: boolean } | null
  linkPageId: string | null; visibility: 'all' | 'gm' | 'some'; visibleTo: string[]; hiddenByFog: boolean
}

type Props = {
  pins: Pin[]
  view: { x: number; y: number; scale: number }
  width: number
  height: number
  isGm: boolean
  campaignId: string
  members: { id: string; name: string }[]
  pages: { id: string; title: string }[]
  onUpdate: (id: string, patch: Partial<Pin>) => void
  onDelete: (id: string) => void
  openId: string | null
  setOpenId: (id: string | null) => void
}

// Pins em HTML por cima do mapa (P1–P8, W8). Mesmo componente para cena e mapa da wiki.
export function PinLayer({ pins, view, width, height, isGm, campaignId, members, pages, onUpdate, onDelete, openId, setOpenId }: Props) {
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, width, height }}>
        {pins.map((p) => {
          const x = drag?.id === p.id ? drag.x : p.x, y = drag?.id === p.id ? drag.y : p.y
          const size = 34 * (p.note?.size ?? 1)
          const color = p.note?.color ?? '#c9a24a'
          return (
            <div key={p.id} className="pointer-events-auto absolute" style={{ left: x * width, top: y * height, transform: `translate(-50%, -50%) scale(${1 / view.scale})` }}>
              <button
                aria-label={p.label || 'Ponto de interesse'}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  if (!isGm || e.button !== 0) return
                  const sx = e.clientX, sy = e.clientY
                  let moved = false
                  const move = (ev: PointerEvent) => {
                    if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 4) moved = true
                    if (moved) setDrag({ id: p.id, x: clamp(p.x + (ev.clientX - sx) / view.scale / width), y: clamp(p.y + (ev.clientY - sy) / view.scale / height) })
                  }
                  window.addEventListener('pointermove', move)
                  window.addEventListener('pointerup', (ev) => {
                    window.removeEventListener('pointermove', move)
                    setDrag(null)
                    if (moved) onUpdate(p.id, { x: clamp(p.x + (ev.clientX - sx) / view.scale / width), y: clamp(p.y + (ev.clientY - sy) / view.scale / height) })
                  }, { once: true })
                }}
                onClick={() => setOpenId(openId === p.id ? null : p.id)}
                className={`flex items-center justify-center border-2 shadow-lg ${p.note?.round === false ? 'rounded-md' : 'rounded-full'} ${isGm ? 'cursor-grab' : 'cursor-pointer'}`}
                style={{ width: size, height: size, borderColor: color, background: p.imageAssetId ? `center/cover url(/api/assets/${p.imageAssetId})` : '#262c3b', color }}>
                {!p.imageAssetId && <DynamicIcon name={(p.icon as IconName) || 'map-pin'} size={size * 0.55} fallback={() => <span>•</span>} />}
                {isGm && p.visibility !== 'all' && <EyeOff aria-label="Oculto para jogadores" size={12} className="absolute -top-1 -right-1 rounded-full bg-bg text-fumble" />}
              </button>
              {p.label && <span className="absolute top-full left-1/2 mt-0.5 -translate-x-1/2 rounded bg-black/70 px-1 text-xs whitespace-nowrap text-white">{p.label}</span>}
              {openId === p.id && (
                <div className="absolute top-0 left-full z-10 ml-2 w-72 cursor-auto" onPointerDown={(e) => e.stopPropagation()}>
                  {isGm
                    ? <PinEditor pin={p} campaignId={campaignId} members={members} pages={pages} onUpdate={(patch) => onUpdate(p.id, patch)} onDelete={() => onDelete(p.id)} onClose={() => setOpenId(null)} />
                    : <PinNote pin={p} campaignId={campaignId} pages={pages} onClose={() => setOpenId(null)} />}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PinNote({ pin: p, campaignId, pages, onClose }: { pin: Pin; campaignId: string; pages: { id: string; title: string }[]; onClose: () => void }) {
  const link = pages.find((x) => x.id === p.linkPageId)
  return (
    <div className="card space-y-2 p-3 text-sm shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <strong>{p.label || 'Ponto de interesse'}</strong>
        <button aria-label="Fechar" onClick={onClose}><X size={14} /></button>
      </div>
      {p.note?.text && <p className="whitespace-pre-wrap text-muted">{p.note.text}</p>}
      {link && <Link className="text-accent hover:underline" href={`/c/${campaignId}/wiki/${link.id}`}>{link.title} →</Link>}
    </div>
  )
}

function PinEditor({ pin: p, campaignId, members, pages, onUpdate, onDelete, onClose }: { pin: Pin; campaignId: string; members: { id: string; name: string }[]; pages: { id: string; title: string }[]; onUpdate: (patch: Partial<Pin>) => void; onDelete: () => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const found = useMemo(() => (q.length < 2 ? PIN_ICONS : iconNames.filter((n) => n.includes(q.toLowerCase())).slice(0, 40)), [q])
  const note = p.note ?? { text: '' }
  const setNote = (patch: Partial<NonNullable<Pin['note']>>) => onUpdate({ note: { ...note, ...patch } })
  return (
    <div className="card max-h-[70vh] space-y-3 overflow-y-auto p-3 text-sm shadow-xl">
      <div className="flex items-center gap-2">
        <input className="input py-1" aria-label="Nome do pin" placeholder="Nome no mapa" defaultValue={p.label ?? ''} onBlur={(e) => e.target.value !== (p.label ?? '') && onUpdate({ label: e.target.value })} />
        <button aria-label="Fechar" onClick={onClose}><X size={16} /></button>
      </div>
      <textarea className="input min-h-20" aria-label="Nota" placeholder="Nota que abre ao clicar" defaultValue={note.text} onBlur={(e) => e.target.value !== note.text && setNote({ text: e.target.value })} />
      <select className="input py-1" aria-label="Página da wiki" value={p.linkPageId ?? ''} onChange={(e) => onUpdate({ linkPageId: e.target.value || null })}>
        <option value="">Sem página ligada</option>
        {pages.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
      </select>

      <fieldset className="space-y-1">
        <legend className="label">Ícone</legend>
        <div className="grid grid-cols-8 gap-1">
          {found.map((n) => <button key={n} title={n} aria-label={n} className={`rounded p-1 hover:bg-bg ${!p.imageAssetId && (p.icon || 'map-pin') === n ? 'text-accent' : ''}`} onClick={() => onUpdate({ icon: n, imageAssetId: null })}><DynamicIcon name={n} size={18} /></button>)}
        </div>
        <input className="input py-1" placeholder="Mais ícones, em inglês (ex.: bridge, wheat)" aria-label="Buscar ícone" value={q} onChange={(e) => setQ(e.target.value)} />
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="label">Quem vê</legend>
        <div className="flex gap-1">
          {(['gm', 'all', 'some'] as const).map((v) => (
            <button key={v} className={`btn flex-1 px-2 py-1 text-xs ${p.visibility === v ? 'border-accent text-accent' : ''}`} onClick={() => onUpdate({ visibility: v })}>
              {{ gm: 'Só mestre', all: 'Todos', some: 'Escolher' }[v]}
            </button>
          ))}
        </div>
        {p.visibility === 'gm' && <button className="btn btn-primary w-full py-1 text-xs" onClick={() => onUpdate({ visibility: 'all' })}>Revelar para todos agora</button>}
        {p.visibility === 'some' && members.map((m) => (
          <label key={m.id} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={p.visibleTo.includes(m.id)} onChange={(e) => onUpdate({ visibleTo: e.target.checked ? [...p.visibleTo, m.id] : p.visibleTo.filter((x) => x !== m.id) })} /> {m.name}
          </label>
        ))}
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={p.hiddenByFog} onChange={(e) => onUpdate({ hiddenByFog: e.target.checked })} /> Escondido pela névoa até alguém ver
        </label>
      </fieldset>

      <details>
        <summary className="cursor-pointer text-xs text-muted">Mais opções</summary>
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <input type="color" aria-label="Cor" value={note.color ?? '#c9a24a'} onChange={(e) => setNote({ color: e.target.value })} />
            <input type="range" aria-label="Tamanho" min={0.5} max={3} step={0.25} value={note.size ?? 1} onChange={(e) => setNote({ size: Number(e.target.value) })} />
          </div>
          <label className="btn w-full cursor-pointer py-1 text-xs">
            Usar imagem no lugar do ícone
            <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) onUpdate({ imageAssetId: (await upload(campaignId, f, 'image')).id }) }} />
          </label>
          {p.imageAssetId && (
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={note.round !== false} onChange={(e) => setNote({ round: e.target.checked })} /> Recorte redondo</label>
          )}
        </div>
      </details>
      <button className="btn w-full py-1 text-xs text-fumble" onClick={onDelete}><Trash2 size={12} /> Apagar pin</button>
    </div>
  )
}

// Atalhos para locais comuns de mapa; o resto do lucide vem pela busca.
const PIN_ICONS: IconName[] = [
  'map-pin', 'flag', 'house', 'castle', 'tent', 'tree-pine', 'mountain', 'landmark',
  'church', 'store', 'beer', 'anvil', 'swords', 'shield', 'skull', 'ghost',
  'crown', 'gem', 'key', 'scroll', 'flame', 'compass', 'anchor', 'circle-help',
]

const clamp = (v: number) => Math.max(0, Math.min(1, v))
