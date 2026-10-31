'use client'
import { useEffect, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import type { Grid } from '@grimorio/core'
import type { TokenView } from './board-canvas'
import { upload } from '@/lib/upload'
import { libraryList, type Item } from '../library-actions'
import type { Light, Wall } from './lighting'

// Metros ⇄ pixels do mapa pelo grid da cena; o controle anda de um quadrado em um quadrado.
function scale(grid?: Grid) {
  const unit = grid?.unit || 1.5, size = grid?.size || 70
  return { unit, meters: (px: number) => Math.round((px / size) * unit * 10) / 10, px: (m: number) => Math.min(10_000, (m / unit) * size) }
}

// Raio no controle deslizante (mexe na hora e só avisa o servidor quando a mão para) ou digitado (vale ao sair do campo ou no Enter).
function Radius({ label, value, unit, onChange }: { label: string; value: number; unit: number; onChange: (m: number) => void }) {
  const [v, setV] = useState(String(value))
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => setV(String(value)), [value])
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="flex items-center gap-1">
          <input type="number" aria-label={label} className="input w-16 px-1 py-0 text-right text-xs tabular-nums" min={0} step="any" value={v} onChange={(e) => setV(e.target.value)}
            onBlur={() => { const m = Math.max(0, Number(v) || 0); if (m !== value) onChange(m); else setV(String(value)) }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
          m
        </span>
      </div>
      <input type="range" aria-label={label} className="w-full accent-accent" min={0} max={unit * 40} step={unit} value={Number(v) || 0} onChange={(e) => {
        const m = Number(e.target.value)
        setV(String(m))
        clearTimeout(timer.current)
        timer.current = setTimeout(() => onChange(m), 150)
      }} />
    </div>
  )
}

// Luz clara nunca passa da penumbra: mexer numa empurra a outra.
function LightRadii({ light, grid, onChange }: { light: { bright: number; dim: number } | null; grid?: Grid; onChange: (l: { bright: number; dim: number }) => void }) {
  const { unit, meters, px } = scale(grid)
  const bright = light?.bright ?? 0, dim = light?.dim ?? 0
  return (
    <>
      <Radius label="Luz clara" value={meters(bright)} unit={unit} onChange={(m) => onChange({ bright: px(m), dim: Math.max(dim, px(m)) })} />
      <Radius label="Penumbra (até onde a luz chega)" value={meters(dim)} unit={unit} onChange={(m) => onChange({ bright: Math.min(bright, px(m)), dim: px(m) })} />
    </>
  )
}

// Ponto de luz: abre pelo lápis, com a luz selecionada.
export function LightEditor({ light, grid, onPatch, onClose }: { light: Light; grid?: Grid; onPatch: (p: { bright: number; dim: number }) => void; onClose: () => void }) {
  return (
    <div className="animate-pop absolute top-14 left-14 z-20 w-72 space-y-3 rounded-lg border border-line bg-panel p-3 text-sm shadow-xl">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Ponto de luz</h2>
        <button aria-label="Fechar" onClick={onClose}><X size={16} /></button>
      </div>
      <LightRadii light={light} grid={grid} onChange={onPatch} />
    </div>
  )
}

function Choice<T extends string>({ label, value, options, onPick }: { label: string; value: T | null; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="label">{label}</legend>
      <div className="flex gap-1">
        {options.map(([v, text]) => <button key={v} aria-pressed={v === value} className={`btn flex-1 py-1 text-xs ${v === value ? 'border-accent text-accent' : ''}`} onClick={() => onPick(v)}>{text}</button>)}
      </div>
    </fieldset>
  )
}

// Barreira: abre pelo lápis, com a parede selecionada. Mover as pontas é pelas alças, no mapa.
export function WallEditor({ wall, onPatch, onClose }: { wall: Wall; onPatch: (p: Partial<Pick<Wall, 'kind' | 'state'>>) => void; onClose: () => void }) {
  return (
    <div className="animate-pop absolute top-14 left-14 z-20 w-72 space-y-3 rounded-lg border border-line bg-panel p-3 text-sm shadow-xl">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Barreira</h2>
        <button aria-label="Fechar" onClick={onClose}><X size={16} /></button>
      </div>
      <Choice label="Tipo" value={wall.kind} options={[['wall', 'Parede'], ['door', 'Porta'], ['window', 'Janela']]} onPick={(kind) => onPatch({ kind })} />
      {wall.kind === 'door' && <Choice label="Estado" value={wall.state} options={[['open', 'Aberta'], ['closed', 'Fechada'], ['locked', 'Trancada']]} onPick={(state) => onPatch({ state })} />}
    </div>
  )
}

// Editar no lugar (regra 3): nome, imagem e tamanho; luz e visão só para o mestre, senão o jogador acenderia o próprio escuro.
export function TokenEditor({ token: t, campaignId, grid, isGm, onPatch, onError, onClose }: { token: TokenView; campaignId: string; grid?: Grid; isGm: boolean; onPatch: (p: Record<string, unknown>) => void; onError: (e: unknown) => void; onClose: () => void }) {
  const { meters, px } = scale(grid)
  const [actors, setActors] = useState<{ title: string; items: Item[] }[]>([])
  useEffect(() => {
    if (!isGm) return
    Promise.all([libraryList(campaignId, 'characters'), libraryList(campaignId, 'creatures')])
      .then(([c, k]) => setActors([{ title: 'Personagens', items: c.items }, { title: 'Criaturas', items: k.items }])).catch(onError)
  }, [campaignId, isGm, onError])
  return (
    <div className="absolute top-14 left-14 z-20 w-72 space-y-3 rounded-lg border border-line bg-panel p-3 text-sm shadow-xl">
      <div className="flex items-center gap-2">
        <input className="input py-1" aria-label="Nome do token" defaultValue={t.name} key={t.id} onBlur={(e) => e.target.value !== t.name && onPatch({ name: e.target.value })} />
        <button aria-label="Fechar" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="flex items-center gap-2">
        <label title="Trocar imagem" className="relative size-12 shrink-0 cursor-pointer overflow-hidden rounded-full border border-line bg-raised bg-cover bg-center transition-colors hover:border-accent" style={t.image ? { backgroundImage: `url(/api/assets/${t.image})` } : undefined}>
          {!t.image && <ImagePlus size={18} className="absolute inset-0 m-auto text-muted" aria-hidden />}
          <input type="file" accept="image/*" aria-label="Imagem do token" className="sr-only" onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) upload(campaignId, file, 'image').then((a) => onPatch({ imageAssetId: a.id })).catch(onError)
          }} />
        </label>
        {isGm && <label className="min-w-0 flex-1"><span className="label">Ficha vinculada</span>
          <select className="input py-1" aria-label="Ficha vinculada" value={t.actorId ?? ''} onChange={(e) => {
            const a = actors.flatMap((g) => g.items).find((i) => i.id === e.target.value)
            onPatch({ actorId: a?.id ?? null, ...(a ? { name: a.name } : {}) })
          }}>
            <option value="">Nenhuma</option>
            {actors.map((g) => <optgroup key={g.title} label={g.title}>{g.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</optgroup>)}
          </select>
        </label>}
      </div>
      <label className="flex items-center justify-between">Tamanho
        <select className="input w-24 py-1" value={t.size} onChange={(e) => onPatch({ size: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}×{n}</option>)}
        </select>
      </label>
      {isGm && <fieldset className="space-y-2">
        <legend className="label">Luz do token</legend>
        <LightRadii light={t.light} grid={grid} onChange={(l) => onPatch({ light: l.dim ? { ...l, color: t.light?.color ?? '#ffaa44' } : null })} />
        <div className="flex gap-1">
          <button className="btn flex-1 py-1 text-xs" onClick={() => onPatch({ light: { bright: px(6), dim: px(12), color: '#ffaa44' } })}>Tocha (6 / 12 m)</button>
          <button className="btn flex-1 py-1 text-xs" disabled={!t.light} onClick={() => onPatch({ light: null })}>Apagar luz</button>
        </div>
      </fieldset>}
      {isGm && <details>
        <summary className="cursor-pointer text-xs text-muted">Visão</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label><span className="label">Visão (m)</span><input className="input py-1" type="number" min={0} placeholder="ilimitada" defaultValue={t.vision?.range ? meters(t.vision.range) : ''} onBlur={(e) => onPatch({ vision: { range: e.target.value ? px(Number(e.target.value)) : 0, dark: t.vision?.dark ?? 0 } })} /></label>
          <label><span className="label">No escuro (m)</span><input className="input py-1" type="number" min={0} defaultValue={t.vision?.dark ? meters(t.vision.dark) : ''} onBlur={(e) => onPatch({ vision: { range: t.vision?.range ?? 0, dark: e.target.value ? px(Number(e.target.value)) : 0 } })} /></label>
        </div>
      </details>}
    </div>
  )
}
