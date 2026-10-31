'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MapPin, Expand } from 'lucide-react'
import { request, useRealtime, useSocketEvent } from '../realtime'
import { PinLayer, type Pin } from '../pin-layer'
import { DropZone } from '../drop-zone'
import { upload } from '@/lib/upload'
import { useWiki } from './context'

type MapInfo = { id: string; assetId: string; width: number | null; height: number | null }

// Página do tipo mapa (W8): imagem com zoom e pan e os mesmos pins do tabuleiro (P1–P8).
export function MapPage({ pageId }: { pageId: string }) {
  const { socket, campaignId } = useRealtime()
  const { isGm, members, pages } = useWiki()
  const [map, setMap] = useState<MapInfo | null>(null)
  const [pins, setPins] = useState<Pin[]>([])
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const [placing, setPlacing] = useState(false)
  const [openPin, setOpenPin] = useState<string | null>(null)
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)

  const load = useCallback(() => request<{ map: MapInfo | null; pins: Pin[] }>(socket, 'map:join', { pageId }).then((r) => { setMap(r.map); setPins(r.pins); setLoaded(true) }).catch((e) => setError(e.message)), [socket, pageId])
  useEffect(() => { load() }, [load])
  useSocketEvent<{ pageId: string }>('map:changed', useCallback((m) => m.pageId === pageId && load(), [pageId, load]))
  useSocketEvent<Pin & { mapId?: string }>('pin:upsert', useCallback((p) => p.mapId === map?.id && setPins((ps) => [...ps.filter((x) => x.id !== p.id), p]), [map?.id]))
  useSocketEvent<{ id: string }>('pin:remove', useCallback(({ id }) => setPins((ps) => ps.filter((x) => x.id !== id)), []))

  const w = map?.width ?? 1000, h = map?.height ?? 1000
  const fit = useCallback(() => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    const s = Math.min(r.width / w, r.height / h)
    setView({ x: (r.width - w * s) / 2, y: (r.height - h * s) / 2, scale: s })
  }, [w, h])
  useEffect(() => { if (map) fit() }, [map, fit])

  if (!loaded) return <p className="text-muted">{error || 'Abrindo mapa…'}</p>
  if (!map) {
    return isGm
      ? <DropZone accept="image/*" label="Solte a imagem do mapa" onFile={async (f) => { try { await request(socket, 'map:set', { pageId, assetId: (await upload(campaignId, f, 'map')).id }) } catch (e) { setError((e as Error).message) } }} />
      : <p className="text-muted">Este mapa ainda não tem imagem.</p>
  }

  return (
    <div className="relative">
      {isGm && (
        <div className="mb-2 flex gap-1">
          <button className={`btn ${placing ? 'border-accent text-accent' : ''}`} aria-pressed={placing} onClick={() => setPlacing(!placing)}><MapPin size={14} /> Pôr pin</button>
          <button className="btn" onClick={fit}><Expand size={14} /> Enquadrar</button>
          <label className="btn cursor-pointer">Trocar imagem<input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) await request(socket, 'map:set', { pageId, assetId: (await upload(campaignId, f, 'map')).id }) }} /></label>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-fumble">{error}</p>}
      <div ref={box} data-testid="world-map" className={`relative h-[70vh] overflow-hidden rounded-lg border border-line bg-black ${placing ? 'cursor-crosshair' : 'cursor-grab'}`}
        onWheel={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const mx = e.clientX - r.left, my = e.clientY - r.top
          const s = Math.min(8, Math.max(0.05, view.scale * Math.exp(-e.deltaY * 0.0015)))
          setView({ scale: s, x: mx - ((mx - view.x) * s) / view.scale, y: my - ((my - view.y) * s) / view.scale })
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          const r = e.currentTarget.getBoundingClientRect()
          if (placing) {
            const x = (e.clientX - r.left - view.x) / view.scale / w, y = (e.clientY - r.top - view.y) / view.scale / h
            if (x >= 0 && x <= 1 && y >= 0 && y <= 1) request<{ id: string }>(socket, 'pin:create', { mapId: map.id, x, y }).then((p) => { setPlacing(false); setOpenPin(p.id) }).catch((er) => setError(er.message))
            return
          }
          const sx = e.clientX, sy = e.clientY, v = view
          const move = (ev: PointerEvent) => setView({ ...v, x: v.x + ev.clientX - sx, y: v.y + ev.clientY - sy })
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true })
        }}>
        <img src={`/api/assets/${map.assetId}`} alt="" draggable={false} className="absolute top-0 left-0 max-w-none origin-top-left select-none" style={{ width: w, height: h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
        <PinLayer pins={pins} view={view} width={w} height={h} isGm={isGm} campaignId={campaignId} members={members} pages={pages} openId={openPin} setOpenId={setOpenPin}
          onUpdate={(id, patch) => request(socket, 'pin:update', { id, patch }).catch((e) => setError(e.message))}
          onDelete={(id) => { setOpenPin(null); request(socket, 'pin:delete', { id }).catch((e) => setError(e.message)) }} />
      </div>
    </div>
  )
}
