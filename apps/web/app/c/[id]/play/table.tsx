'use client'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Brush, Eraser, Expand, Grid3x3, Hand, ImagePlus, Layers, MapPin, MousePointer2, Ruler, ScrollText, Sparkles, Swords, Trash2 } from 'lucide-react'
import { defaultTorch, type Grid } from '@grimorio/core'
import { request, useRealtime, useSocketEvent } from '@/components/realtime'
import { PinLayer, type Pin } from '@/components/pin-layer'
import { upload } from '@/lib/upload'
import { createScene } from '../../../campaign-actions'
import { Board, type DrawingView, type SceneView, type TokenView, type Tool } from './board-canvas'
import { ScenePanel } from './scene-panel'
import type { CombatView } from './combat-panel'
import { LibraryBar, type DropPoint, type LibraryDrag } from './library'
import { useWindows } from '@/components/windows'
import { LightEditor, TokenEditor, WallEditor } from './token-editor'
import { EffectsDialog } from './effects-dialog'
import { TokenTooltip } from './token-tooltip'
import { LightingTools, SelectionBar, lightingHint, useLighting, type Light, type Wall, type FogData } from './lighting'

export type TableProps = {
  campaignId: string
  actors: { id: string; name: string; avatarAssetId: string | null; sheetId: string | null; pc: boolean }[]
  members: { id: string; name: string }[]
  pages: { id: string; title: string }[]
}

type Snapshot = { scene: SceneView | null; tokens: TokenView[]; pins: Pin[]; drawings: DrawingView[]; walls: Wall[]; lights: Light[]; combat: CombatView | null; fog: FogData | null }
// Desfazer (Ctrl+Z) do mestre: cada edição guarda a operação inversa (um evento ou uma função).
type Undo = { event: string; payload: unknown } | (() => Promise<unknown>)

const SNAPSHOT_EVERY = 2 * 60_000

// Tudo síncrono até o fetch: ao fechar a aba, toBlob não chegaria a terminar. Com keepalive o navegador aceita no máximo 64 KB.
function saveSnapshot(b: Board, campaignId: string) {
  const shot = b.snapshot(640)
  if (!shot) return
  const body = Uint8Array.from(atob(shot.toDataURL('image/jpeg', 0.7).split(',')[1]!), (ch) => ch.charCodeAt(0))
  return fetch(`/c/${campaignId}/snapshot`, { method: 'POST', body, keepalive: body.length < 60_000 }).catch(() => {})
}

export function Table({ campaignId, actors, members, pages }: TableProps) {
  const { socket, me } = useRealtime()
  const router = useRouter()
  const t = useTranslations('table')
  const isGm = me.role === 'gm'
  const host = useRef<HTMLDivElement>(null)
  const board = useRef<Board | null>(null)
  const [scene, setScene] = useState<SceneView | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [tokens, setTokens] = useState(new Map<string, TokenView>())
  const [pins, setPins] = useState<Pin[]>([])
  const [walls, setWalls] = useState<Wall[]>([])
  const [lights, setLights] = useState<Light[]>([])
  const [fog, setFog] = useState<FogData | null>(null)
  const [combat, setCombat] = useState<CombatView | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [tool, setTool] = useState<Tool>('select')
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const [openPin, setOpenPin] = useState<string | null>(null)
  const [sceneMenu, setSceneMenu] = useState(false)
  const [editToken, setEditToken] = useState<string | null>(null)
  const [effectsToken, setEffectsToken] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [drawColor, setDrawColor] = useState('#e5c07b')
  const [boardGen, setBoardGen] = useState(0)
  const undo = useRef<Undo[]>([])
  const { open: openWin } = useWindows()
  const openWinRef = useRef(openWin)
  openWinRef.current = openWin
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const combatRef = useRef(combat)
  combatRef.current = combat
  const tokensRef = useRef(tokens)
  tokensRef.current = tokens

  const fail = useCallback((e: unknown) => { setError((e as Error).message); setTimeout(() => setError(''), 4000) }, [])
  // inverse: evento fixo, função que gera o inverso a partir da resposta, ou a própria função de desfazer (sem argumentos).
  const call = useCallback(<T,>(event: string, payload: unknown, inverse?: Undo | ((res: T) => Undo)) =>
    request<T>(socket, event, payload).then((res) => {
      if (inverse) undo.current.push(typeof inverse === 'function' && inverse.length === 1 ? (inverse as (r: T) => Undo)(res) : (inverse as Undo))
      if (undo.current.length > 100) undo.current.shift()
      return res
    }), [socket])

  // --- canvas ---
  useEffect(() => {
    const b = new Board(host.current!, {
      moveToken: (id, x, y, path) => {
        const before = tokensRef.current.get(id)
        call('token:move', { id, x, y, path }, isGm && before ? { event: 'token:move', payload: { id, x: before.x, y: before.y } } : undefined)
          .catch((e) => { if (before) b.revert(id, before.x, before.y); fail(e) })
      },
      select: setSelected,
      hoverToken: setHovered,
      resizeToken: (id, size) => {
        const before = tokensRef.current.get(id)
        call('token:update', { id, patch: { size } }, before && { event: 'token:update', payload: { id, patch: { size: before.size } } }).catch((e) => { if (before) b.upsertToken(before); fail(e) })
      },
      // Duplo clique: mestre edita o token; jogador abre a ficha (edita pelo botão ao selecionar).
      openToken: (id) => {
        const tk = tokensRef.current.get(id)
        if (isGm) setEditToken(id)
        else if (tk?.sheetId) openWinRef.current({ kind: 'sheet', ref: tk.sheetId, title: tk.name })
      },
      draw: (points) => {
        const sc = sceneRef.current
        if (sc) call<{ id: string }>('drawing:create', { sceneId: sc.id, points, color: b.drawColor, width: 4 }, (r) => ({ event: 'drawing:delete', payload: { ids: [r.id] } })).catch(fail)
      },
      erase: (ids) => call('drawing:delete', { ids }).catch(fail),
      ping: (x, y) => request(socket, 'ping', { x, y }).catch(() => {}),
      pin: (x, y) => {
        const sc = sceneRef.current
        if (sc && isGm) call<{ id: string }>('pin:create', { sceneId: sc.id, x, y }, (r) => ({ event: 'pin:delete', payload: { id: r.id } })).then((r) => setOpenPin(r.id)).catch(fail)
      },
      align: (size, offsetX, offsetY) => {
        const sc = sceneRef.current
        if (sc) call('scene:update', { sceneId: sc.id, patch: { grid: { size, offsetX, offsetY } } }, { event: 'scene:update', payload: { sceneId: sc.id, patch: { grid: sc.grid } } }).then(() => setTool('select')).catch(fail)
      },
      view: (x, y, scale) => setView({ x, y, scale }),
      speedOf: (tokenId) => {
        const c = combatRef.current
        const cur = c?.combatants.find((x) => x.current)
        if (!cur || cur.tokenId !== tokenId) return null
        const t = tokensRef.current.get(tokenId)
        return { moved: cur.moved, max: t ? speedCells(t, sceneRef.current?.grid) : null }
      },
    })
    b.isGm = isGm
    // Board trocado (Fast Refresh, mudança de papel): quem pendura coisas nele precisa refazer, o antigo foi destruído.
    if (board.current) setBoardGen((n) => n + 1)
    board.current = b
    return () => {
      // A home já carregou quando a mesa desmonta: sem o refresh, o cartão só mostraria esta foto na visita seguinte.
      saveSnapshot(b, campaignId)?.then(() => { if (location.pathname === '/') router.refresh() })
      b.destroy()
    }
  }, [socket, isGm, call, fail, campaignId, router])

  useEffect(() => {
    const save = () => { if (board.current) saveSnapshot(board.current, campaignId) }
    const timer = setInterval(() => { if (!document.hidden) save() }, SNAPSHOT_EVERY)
    const onHide = () => { if (document.hidden) save() }
    document.addEventListener('visibilitychange', onHide)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onHide) }
  }, [campaignId])

  useEffect(() => { board.current?.setTool(tool) }, [tool, boardGen])
  useEffect(() => { if (board.current) board.current.drawColor = drawColor }, [drawColor])
  useEffect(() => { board.current?.setSelected(selected) }, [selected])
  useEffect(() => { board.current?.setTurn(combat?.combatants.find((c) => c.current)?.tokenId ?? null) }, [combat])

  const apply = useCallback(async (snap: Snapshot) => {
    const b = board.current!
    await b.ready
    setLoaded(true)
    setScene(snap.scene)
    if (!snap.scene) return
    await b.setScene(snap.scene)
    setTokens(new Map(snap.tokens.map((t) => [t.id, t])))
    for (const t of snap.tokens) b.upsertToken(t)
    for (const d of snap.drawings) b.upsertDrawing(d)
    setPins(snap.pins)
    setWalls(snap.walls)
    setLights(snap.lights)
    setFog(snap.fog)
    setCombat(snap.combat)
    setSelected([])
    undo.current = []
  }, [])

  const join = useCallback((sceneId?: string | null) => request<Snapshot>(socket, 'scene:join', { sceneId }).then(apply).catch(fail), [socket, apply, fail])

  useEffect(() => {
    const onConnect = () => join(sceneRef.current?.id)
    if (socket.connected) onConnect()
    socket.on('connect', onConnect)
    return () => void socket.off('connect', onConnect)
  }, [socket, join, boardGen])

  // --- eventos do servidor ---
  useSocketEvent<{ sceneId: string; upsert: TokenView[]; remove: string[] }>('token:sync', useCallback((m) => {
    if (m.sceneId !== sceneRef.current?.id) return
    const b = board.current!
    setTokens((cur) => {
      const next = new Map(cur)
      for (const t of m.upsert) next.set(t.id, t)
      for (const id of m.remove) next.delete(id)
      return next
    })
    for (const t of m.upsert) b.upsertToken(t)
    for (const id of m.remove) b.removeToken(id)
  }, []))
  useSocketEvent<Pin>('pin:upsert', useCallback((p) => setPins((ps) => [...ps.filter((x) => x.id !== p.id), p]), []))
  useSocketEvent<{ id: string }>('pin:remove', useCallback(({ id }) => setPins((ps) => ps.filter((x) => x.id !== id)), []))
  useSocketEvent<DrawingView & { sceneId: string }>('drawing:upsert', useCallback((d) => d.sceneId === sceneRef.current?.id && board.current?.upsertDrawing(d), []))
  useSocketEvent<{ ids: string[] }>('drawing:remove', useCallback(({ ids }) => ids.forEach((id) => board.current?.removeDrawing(id)), []))
  useSocketEvent<{ x: number; y: number; userId: string }>('ping', useCallback((p) => board.current?.ping(p.x, p.y, p.userId === me.userId ? '#c9a24a' : '#5fbf7a'), [me.userId]))
  useSocketEvent<{ sceneId: string; combat: CombatView | null }>('combat:state', useCallback((m) => m.sceneId === sceneRef.current?.id && setCombat(m.combat), []))
  useSocketEvent<{ sceneId: string | null }>('scene:activated', useCallback(({ sceneId }) => { if (!isGm || !sceneId) join(sceneId) }, [isGm, join]))
  useSocketEvent<{ sceneId: string }>('scene:deleted', useCallback(({ sceneId }) => { if (sceneId === sceneRef.current?.id) join(null) }, [join]))
  useSocketEvent<{ sceneId: string; patch: Partial<SceneView> & { grid?: Grid } }>('scene:patched', useCallback(({ sceneId, patch }) => {
    const sc = sceneRef.current
    if (!sc || sc.id !== sceneId) return
    const next = { ...sc, ...patch }
    setScene(next)
    board.current?.setScene(next).then(() => tokensRef.current.forEach((t) => board.current?.upsertToken(t)))
  }, []))

  const picked = selected.length === 1 ? tokens.get(selected[0]!) : undefined
  const { viewAs, setViewAs, pickedWall, pickedLight, editing, setEditing, remove } = useLighting({ board, boardGen, scene, tokens, walls, lights, fog, setWalls, setLights, setFog, isGm, selected, setSelected, tool, setTool, call, onError: fail })

  // --- teclado ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, dialog, [contenteditable]')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && isGm) {
        e.preventDefault()
        const u = undo.current.pop()
        if (u) (typeof u === 'function' ? u() : request(socket, u.event, u.payload)).catch(fail)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && isGm && selected.length) {
        call('token:delete', { ids: selected }, restoreTokens(selected)).catch(fail)
        return
      }
      const keys: Record<string, Tool> = { v: 'select', h: 'pan', r: 'ruler', d: 'draw', e: 'erase', ...(isGm ? { p: 'pin' } : {}) }
      const t = keys[e.key.toLowerCase()]
      if (t && !e.ctrlKey && !e.metaKey) setTool(t)
      if (e.key === 'Escape') (setTool('select'), setOpenPin(null))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isGm, selected, socket, call, fail])

  // Desfazer um "apagar token" recria com o mesmo id e os mesmos dados.
  const restoreTokens = (ids: string[]) => {
    const gone = ids.map((id) => tokensRef.current.get(id)).filter((t): t is TokenView => !!t)
    const sc = sceneRef.current
    return () => Promise.all(gone.map((t) => request(socket, 'token:create', { id: t.id, sceneId: sc?.id, actorId: t.actorId, name: t.name, imageAssetId: t.image, x: t.x, y: t.y, size: t.size, layer: t.layer, vision: t.vision, light: t.light })))
  }

  // --- soltar no mapa: item da biblioteca ou arquivo do computador (T1, T4) ---
  const dropOnBoard = async (item: LibraryDrag | null, file: File | undefined, e: DropPoint) => {
    const b = board.current!
    const w = b.toWorld(e.clientX, e.clientY)
    const sc = sceneRef.current
    // Jogador só coloca os próprios personagens (a biblioteca dele só lista esses).
    if (!isGm && item?.category !== 'characters') return
    const undoCreate = (r: { id: string }) => ({ event: 'token:delete', payload: { ids: [r.id] } })
    try {
      if (item?.category === 'maps') return void join(item.id)
      if (!sc) {
        if (!file?.type.startsWith('image/')) return
        const a = await upload(campaignId, file, 'map')
        const s = await createScene(campaignId, a.id, file.name.replace(/\.[^.]+$/, ''))
        return void join(s.id)
      }
      const g = sc.grid
      // Com grid, cai na célula sob o cursor; sem grid, o token nasce centrado nele.
      const place = (v: number, off: number) => g.show ? Math.floor((v - off) / g.size) * g.size + off : v - g.size / 2
      const x = place(w.x, g.offsetX), y = place(w.y, g.offsetY)
      if (item?.category === 'characters' || item?.category === 'creatures') {
        await call<{ id: string }>('token:create', { sceneId: sc.id, actorId: item.id, name: item.name, x, y, vision: { range: 0, dark: 0 }, light: item.pc ? defaultTorch(g) : null }, undoCreate)
      } else if (item && (item.category === 'props' || (item.category === 'attachments' && item.image))) {
        await call<{ id: string }>('token:create', { sceneId: sc.id, imageAssetId: item.id, name: item.name, x, y, layer: e.altKey ? 'gm' : 'tokens' }, undoCreate)
      } else if (item && (item.category === 'notes' || item.category === 'attachments')) {
        // Nota vira um pin ligado à página (só o mestre vê até revelar).
        await call<{ id: string }>('pin:create', { sceneId: sc.id, x: w.x / sc.width, y: w.y / sc.height, label: item.name, linkPageId: item.category === 'notes' ? item.id : null, visibility: 'gm' }, (r) => ({ event: 'pin:delete', payload: { id: r.id } }))
      } else if (file?.type.startsWith('image/')) {
        const a = await upload(campaignId, file, 'image')
        await call<{ id: string }>('token:create', { sceneId: sc.id, imageAssetId: a.id, name: file.name.replace(/\.[^.]+$/, ''), x, y, layer: e.altKey ? 'gm' : 'tokens' }, undoCreate)
      }
    } catch (err) { fail(err) }
  }

  // Jogador abre a mesa com a própria ficha numa janela (uma vez; se fechar, fica fechada).
  useEffect(() => {
    const mine = !isGm && actors.find((a) => a.sheetId)
    const flag = `grimorio:ficha-auto:${campaignId}`
    if (!mine || localStorage.getItem(flag)) return
    localStorage.setItem(flag, '1')
    openWin({ kind: 'sheet', ref: mine.sheetId!, title: mine.name })
  }, [isGm, actors, campaignId, openWin])

  useEffect(() => {
    const focus = (e: Event) => { const tk = tokensRef.current.get((e as CustomEvent<string>).detail); if (tk) board.current?.centerOn(tk.x, tk.y) }
    window.addEventListener('grimorio:focus-token', focus)
    return () => window.removeEventListener('grimorio:focus-token', focus)
  }, [])

  const tools: { t: Tool; icon: typeof Ruler; label: string; gm?: boolean }[] = [
    { t: 'select', icon: MousePointer2, label: t('select') },
    { t: 'pan', icon: Hand, label: t('pan') },
    { t: 'ruler', icon: Ruler, label: t('ruler') },
    { t: 'draw', icon: Brush, label: t('draw') },
    { t: 'erase', icon: Eraser, label: t('erase') },
    { t: 'pin', icon: MapPin, label: t('pin'), gm: true },
  ]
  const mine = actors.find((a) => a.sheetId)
  const one = selected.length === 1 ? tokens.get(selected[0]!) : undefined
  const patchToken = (id: string, patch: Record<string, unknown>) => {
    const tk = tokens.get(id)!
    const inverse = Object.fromEntries(Object.keys(patch).map((k) => [k, (tk as Record<string, unknown>)[k === 'imageAssetId' ? 'image' : k]]))
    call('token:update', { id, patch }, { event: 'token:update', payload: { id, patch: inverse } }).catch(fail)
  }

  return (
    <div className="relative flex h-full">
      <div className="relative min-w-0 flex-1" data-map-drop onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); dropOnBoard(null, e.dataTransfer.files[0], e) }}>
        <div ref={host} className="absolute inset-0" data-testid="board" />
        {scene && <PinLayer pins={pins} view={view} width={scene.width} height={scene.height} isGm={isGm} campaignId={campaignId} members={members} pages={pages} openId={openPin} setOpenId={setOpenPin}
          onUpdate={(id, patch) => {
            const before = pins.find((p) => p.id === id)
            const inverse = before && Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof Pin]]))
            call('pin:update', { id, patch }, inverse ? { event: 'pin:update', payload: { id, patch: inverse } } : undefined).catch(fail)
          }}
          onDelete={(id) => {
            const p = pins.find((x) => x.id === id)
            setOpenPin(null)
            call('pin:delete', { id }, p && { event: 'pin:create', payload: { ...p, sceneId: scene.id, mapId: null } }).catch(fail)
          }} />}

        {loaded && !scene && (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-muted">
            {isGm ? t('noSceneGm') : t('noScenePlayer')}
          </div>
        )}

        <div role="toolbar" aria-label={t('tools')} className="absolute top-2 left-2 z-10 flex flex-col gap-1 rounded-lg border border-line bg-panel/95 p-1 shadow-lg">
          {tools.filter((x) => !x.gm || isGm).map(({ t: id, icon: Icon, label }) => (
            <button key={id} title={label} aria-label={label} aria-pressed={tool === id} onClick={() => setTool(id)} className={`btn btn-ghost size-9 p-0 ${tool === id ? 'bg-bg text-accent' : 'text-muted'}`}><Icon size={18} /></button>
          ))}
          {tool === 'draw' && <input type="color" aria-label={t('brush')} value={drawColor} onChange={(e) => setDrawColor(e.target.value)} className="size-9" />}
          {isGm && <LightingTools tool={tool} setTool={setTool} viewAs={viewAs} setViewAs={setViewAs} canViewAs={selected.length === 1} dungeon={!!scene?.dungeon} />}
          <span className="my-1 h-px bg-line" />
          {isGm && <button title={t('alignGridHint')} aria-label={t('alignGrid')} aria-pressed={tool === 'align'} onClick={() => setTool('align')} className={`btn btn-ghost size-9 p-0 ${tool === 'align' ? 'text-accent' : 'text-muted'}`}><Grid3x3 size={18} /></button>}
          <button title={t('fit')} aria-label={t('fit')} onClick={() => board.current?.fit()} className="btn btn-ghost size-9 p-0 text-muted"><Expand size={18} /></button>
        </div>

        <div className="absolute top-2 right-2 z-10 flex gap-1">
          {isGm && scene && <PanelButton on={sceneMenu} onClick={() => setSceneMenu(!sceneMenu)} icon={Layers} label={scene.name} />}
          {scene && (isGm || combat) && <PanelButton on={false} onClick={() => openWin({ kind: 'combat', ref: scene.id, title: t('combat'), w: 480, h: 640 })} icon={Swords} label={t('combat')} />}
          {mine && <PanelButton on={false} onClick={() => openWin({ kind: 'sheet', ref: mine.sheetId!, title: mine.name })} icon={ScrollText} label={t('sheet')} />}
        </div>
        {sceneMenu && isGm && (
          <div className="card animate-pop absolute top-14 right-2 z-30 max-h-[calc(100%-9rem)] w-[30rem] max-w-[calc(100%-1rem)] overflow-y-auto">
            <ScenePanel campaignId={campaignId} current={scene} onOpen={join} onError={fail} />
          </div>
        )}

        {scene && (isGm ? selected.length > 0 : picked?.mine) && (
          <div className="animate-rise absolute bottom-24 left-1/2 z-30 flex w-max max-w-[calc(100%-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-xl border border-line bg-panel/95 p-1 text-sm whitespace-nowrap shadow-lg">
            {picked && <button className="btn px-2 py-1" onClick={() => setEffectsToken(picked.id)}><Sparkles size={14} /> {t('effects')}</button>}
            {!isGm && picked && <>
            {picked.sheetId && <button className="btn px-2 py-1" onClick={() => openWin({ kind: 'sheet', ref: picked.sheetId!, title: picked.name })}><ScrollText size={14} /> {t('sheet')}</button>}
            <button className="btn px-2 py-1" onClick={() => setEditToken(picked.id)}>{t('edit')}</button>
            <button className="btn btn-ghost px-2 py-1 text-fumble" aria-label={t('deleteTokens')} onClick={() => call('token:delete', { ids: [picked.id] }).catch(fail)}><Trash2 size={14} /></button>
            </>}
            {isGm && <>
            <span className="px-2 text-muted">{t('selected', { count: selected.length })}</span>
            {one?.sheetId && <button className="btn px-2 py-1" onClick={() => openWin({ kind: 'sheet', ref: one.sheetId!, title: one.name })}><ScrollText size={14} /> {t('sheet')}</button>}
            <button className="btn px-2 py-1" onClick={() => request(socket, 'combat:start', { sceneId: scene.id, tokenIds: selected }).then(() => openWin({ kind: 'combat', ref: scene.id, title: t('combat'), w: 480, h: 640 })).catch(fail)}>
              <Swords size={14} /> {combat ? t('addCombat') : t('startCombat')}
            </button>
            <button className="btn px-2 py-1" title={t('layerHint')} onClick={() => selected.forEach((id) => {
              const t = tokens.get(id)
              if (t) call('token:update', { id, patch: { layer: t.layer === 'gm' ? 'tokens' : 'gm' } }, { event: 'token:update', payload: { id, patch: { layer: t.layer } } }).catch(fail)
            })}>{selected.every((id) => tokens.get(id)?.layer === 'gm') ? t('show') : t('hide')}</button>
            {one && (
              <label className="btn cursor-pointer px-2 py-1" title={t('changeImage')}>
                <ImagePlus size={14} aria-hidden /> {t('image')}
                <input type="file" accept="image/*" aria-label={t('changeImage')} className="sr-only" onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) upload(campaignId, file, 'image').then((a) => patchToken(one.id, { imageAssetId: a.id })).catch(fail)
                }} />
              </label>
            )}
            {one && <button className="btn px-2 py-1" onClick={() => setEditToken(one.id)}>{t('edit')}</button>}
            <button className="btn btn-ghost px-2 py-1 text-fumble" aria-label={t('deleteTokens')} onClick={() => call('token:delete', { ids: selected }, restoreTokens(selected)).catch(fail)}><Trash2 size={14} /></button>
            </>}
          </div>
        )}

        {effectsToken && tokens.get(effectsToken) && (
          <EffectsDialog name={tokens.get(effectsToken)!.name} active={tokens.get(effectsToken)!.conditions} onClose={() => setEffectsToken(null)} onToggle={(name) => {
            const payload = { id: effectsToken, name }
            call('token:effect', payload, isGm ? { event: 'token:effect', payload } : undefined).catch(fail)
          }} />
        )}

        {hovered && tool === 'select' && scene && tokens.get(hovered) && (
          <TokenTooltip token={tokens.get(hovered)!} combatant={combat?.combatants.find((c) => c.tokenId === hovered)} cell={scene.grid.size} view={view} area={host.current!} />
        )}

        {editToken && tokens.get(editToken) && (
          <TokenEditor token={tokens.get(editToken)!} campaignId={campaignId} grid={scene?.grid} isGm={isGm} onClose={() => setEditToken(null)} onError={fail} onPatch={(patch) => patchToken(editToken, patch)} />
        )}

        <SelectionBar wall={pickedWall} light={pickedLight} view={view} onEdit={() => setEditing(!editing)} onDelete={() => remove((pickedWall ?? pickedLight)!.id)} />
        {editing && pickedLight && (
          <LightEditor light={pickedLight} grid={scene?.grid} onClose={() => setEditing(false)}
            onPatch={(patch) => call('light:update', { id: pickedLight.id, patch }, { event: 'light:update', payload: { id: pickedLight.id, patch: { bright: pickedLight.bright, dim: pickedLight.dim } } }).catch(fail)} />
        )}
        {editing && pickedWall && (
          <WallEditor wall={pickedWall} onClose={() => setEditing(false)}
            onPatch={(patch) => call('wall:update', { id: pickedWall.id, patch }, { event: 'wall:update', payload: { id: pickedWall.id, patch: { kind: pickedWall.kind, state: pickedWall.state } } }).catch(fail)} />
        )}

        {isGm && lightingHint(tool) && <p className="pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded-md bg-panel/95 px-3 py-1.5 text-xs text-muted shadow">{lightingHint(tool)}</p>}
        <LibraryBar onOpenScene={join} onDropItem={(item, at) => dropOnBoard(item, undefined, at)} onError={fail} />
        {error && <p role="alert" className="animate-rise absolute top-16 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-fumble px-3 py-1.5 text-sm text-white shadow">{error}</p>}
      </div>

    </div>
  )
}

function PanelButton({ on, onClick, icon: Icon, label }: { on: boolean; onClick: () => void; icon: typeof Ruler; label: string }) {
  return <button className={`btn bg-panel/95 shadow ${on ? 'border-accent text-accent' : ''}`} aria-pressed={on} onClick={onClick}><Icon size={16} aria-hidden /> {label}</button>
}

// Deslocamento do turno vem da ficha (@deslocamento, em metros) convertido em células.
function speedCells(t: TokenView, g?: Grid) {
  return t.speed && g?.unit ? t.speed / g.unit : null
}
