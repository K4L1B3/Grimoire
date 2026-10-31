'use client'
// Paredes, portas, luz, visão e névoa no cliente (L1–L7). O servidor decide o que o jogador recebe;
// aqui só se desenha, usando a mesma geometria do núcleo.
import { useCallback, useEffect, useRef, useState } from 'react'
import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js'
import { BrickWall, DoorClosed, Eye, Lamp, Pencil, ScanEye, Square, Trash2 } from 'lucide-react'
import { cutWall, moveBlocked, moveSegments, pointInPolygon, sightSegments, unpackBits, visibilityPolygon, type Seg, type WallLike } from '@grimorio/core'
import { request, useRealtime, useSocketEvent } from '@/components/realtime'
import { segDist, type Board, type SceneView, type TokenView, type Tool } from './board-canvas'

export type Wall = { id: string; points: number[]; kind: 'wall' | 'door' | 'window'; state: 'open' | 'closed' | 'locked' | null }
export type Light = { id: string; x: number; y: number; bright: number; dim: number; color: string | null }
export type FogData = { cell: number; cols: number; rows: number; bits: string; reveal: string }
// Geometria e névoa ficam em cache: o polígono de quem não andou e a névoa não mudam entre um quadro e outro.
type Geo = { walls: Wall[]; sight: Seg[]; move: Seg[]; polys: Map<string, number[]> }
type Gfx = { dark: Sprite; canvas: HTMLCanvasElement; lit: HTMLCanvasElement; seen: HTMLCanvasElement; tex: Texture; lines: Graphics; rings: Graphics; doors: Container; preview: Graphics; geo: Geo | null; fog: { of: FogData; canvas: HTMLCanvasElement } | null }
type At = (t: TokenView) => { x: number; y: number }
type Call = <T>(event: string, payload: unknown, inverse?: { event: string; payload: unknown } | ((r: T) => { event: string; payload: unknown } | (() => Promise<unknown>)) | (() => Promise<unknown>)) => Promise<T>

const HINT: Partial<Record<Tool, string>> = {
  wall: 'Clique, clique… para encadear paredes; arraste para uma parede só. Esc termina a cadeia. Shift desliga o grid. Para editar ou apagar, clique na parede com a seta (V).',
  room: 'Arraste um retângulo: cria as 4 paredes da sala.',
  door: 'Clique numa parede: porta de 1 quadrado ali. Arraste: porta do tamanho que quiser, sobre a parede ou num vão. Clique numa porta para selecionar: editar, lixeira ou Del.',
  light: 'Clique para pôr uma luz; clique numa luz para selecionar: editar, lixeira ou Del. Arraste para mover.',
  erase: 'Clique num traço, parede, porta ou luz para apagar.',
  reveal: 'Arraste sobre a área que os jogadores passam a conhecer.',
}

export function LightingTools({ tool, setTool, viewAs, setViewAs, canViewAs, dungeon }: { tool: Tool; setTool: (t: Tool) => void; viewAs: boolean; setViewAs: (v: boolean) => void; canViewAs: boolean; dungeon: boolean }) {
  const tools: { t: Tool; icon: typeof Lamp; label: string }[] = [
    { t: 'wall', icon: BrickWall, label: 'Paredes (W)' },
    { t: 'room', icon: Square, label: 'Sala: arraste para 4 paredes' },
    { t: 'door', icon: DoorClosed, label: 'Porta / janela' },
    { t: 'light', icon: Lamp, label: 'Luz' },
    ...(dungeon ? [{ t: 'reveal' as Tool, icon: ScanEye, label: 'Revelar área na névoa' }] : []),
  ]
  return (
    <>
      <span className="my-1 h-px bg-line" />
      {tools.map(({ t, icon: Icon, label }) => (
        <button key={t} title={label} aria-label={label} aria-pressed={tool === t} onClick={() => setTool(t)} className={`btn btn-ghost size-9 p-0 ${tool === t ? 'bg-bg text-accent' : 'text-muted'}`}><Icon size={18} /></button>
      ))}
      {dungeon && canViewAs && (
        <button title="Ver pelos olhos do token selecionado" aria-label="Ver como o token" aria-pressed={viewAs} onClick={() => setViewAs(!viewAs)} className={`btn btn-ghost size-9 p-0 ${viewAs ? 'bg-bg text-accent' : 'text-muted'}`}><Eye size={18} /></button>
      )}
    </>
  )
}

export function lightingHint(tool: Tool) {
  return HINT[tool]
}

// Ações do item selecionado no mapa (luz, parede, porta, janela), logo acima dele.
export function SelectionBar({ wall, light, view, onEdit, onDelete }: { wall?: Wall; light?: Light; view: { x: number; y: number; scale: number }; onEdit: () => void; onDelete: () => void }) {
  if (!wall && !light) return null
  const x = wall ? (wall.points[0]! + wall.points[2]!) / 2 : light!.x, y = wall ? (wall.points[1]! + wall.points[3]!) / 2 : light!.y
  const name = wall ? { wall: 'parede', door: 'porta', window: 'janela' }[wall.kind] : 'luz'
  return (
    <div className="animate-pop absolute z-20 flex -translate-x-1/2 -translate-y-full gap-1 rounded-lg border border-line bg-panel/95 p-1 shadow-lg" style={{ left: Math.max(64, view.x + x * view.scale), top: Math.max(48, view.y + y * view.scale - 24) }}>
      <button className="btn btn-ghost size-8 p-0" title={`Editar ${name}`} aria-label={`Editar ${name}`} onClick={onEdit}><Pencil size={16} /></button>
      <button className="btn btn-ghost size-8 p-0 text-fumble" title={`Apagar ${name} (Del)`} aria-label={`Apagar ${name}`} onClick={onDelete}><Trash2 size={16} /></button>
    </div>
  )
}

type Args = {
  board: React.RefObject<Board | null>; boardGen: number; scene: SceneView | null; tokens: Map<string, TokenView>; walls: Wall[]; lights: Light[]; fog: FogData | null
  setWalls: (w: Wall[]) => void; setLights: (l: Light[]) => void; setFog: (f: FogData | null) => void
  isGm: boolean; selected: string[]; setSelected: (ids: string[]) => void; tool: Tool; setTool: (t: Tool) => void; call: Call; onError: (e: unknown) => void
}

export function useLighting({ board, boardGen, scene, tokens, walls, lights, fog, setWalls, setLights, setFog, isGm, selected, setSelected, tool, setTool, call, onError }: Args) {
  const { socket } = useRealtime()
  const [viewAs, setViewAs] = useState(false)
  // Item selecionado no mapa (id de parede ou de luz) e se o editor dele está aberto.
  const [sel, setSel] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const gfx = useRef<Gfx | null>(null)
  const chain = useRef<{ x: number; y: number } | null>(null)
  const st = useRef({ scene, walls, lights, tool, sel, tokens, fog, selected, viewAs })
  st.current = { scene, walls, lights, tool, sel, tokens, fog, selected, viewAs }
  const reach = useRef(new Map<string, { x: number; y: number }>())

  // Só o que acompanha o token andando: anéis de alcance e escuridão. Roda a cada quadro de movimento.
  const paintLight = useCallback(() => {
    const g = gfx.current, b = board.current, { scene, walls, lights, tokens, fog, selected, viewAs } = st.current
    if (!g || !b || !scene || g.lines.destroyed) return null
    const geo = geometry(g, walls), at = liveCenter(b, scene, geo, isGm, reach.current)
    drawRings(g, b, isGm, selected.flatMap((id) => { const t = tokens.get(id); return t?.light ? [{ ...at(t), ...t.light }] : [] }))
    const viewers = pickViewers(tokens, at, isGm, viewAs ? selected[0] : null)
    drawDarkness(g, geo, scene, lights, tokens, at, viewers, fog, isGm && !viewAs)
    return viewers
  }, [board, isGm])

  const pick = useCallback((id: string | null, edit = false) => {
    setSel(id)
    setEditing(edit)
    if (id) setSelected([])
  }, [setSelected])
  const remove = useCallback((id: string) => {
    const { walls, lights, scene } = st.current
    const w = walls.find((x) => x.id === id), l = lights.find((x) => x.id === id)
    pick(null)
    if (w) call('wall:delete', { ids: [id] }, { event: 'wall:create', payload: { sceneId: scene!.id, walls: [w] } }).catch(onError)
    if (l) call('light:delete', { id }, { event: 'light:create', payload: { ...l, sceneId: scene!.id } }).catch(onError)
  }, [call, onError, pick])

  useSocketEvent<{ sceneId: string; walls: Wall[]; lights: Light[] }>('scene:lighting', useCallback((m) => {
    if (m.sceneId !== st.current.scene?.id) return
    setWalls(m.walls)
    setLights(m.lights)
  }, [setWalls, setLights]))
  useSocketEvent<FogData & { sceneId: string }>('fog:sync', useCallback((m) => m.sceneId === st.current.scene?.id && setFog(m), [setFog]))

  // Camadas no Pixi: escuridão (canvas 2D como textura), linhas de parede e ícones de porta.
  useEffect(() => {
    const b = board.current
    if (!b) return
    let alive = true
    b.ready.then(() => {
      if (!alive) return
      const canvas = document.createElement('canvas')
      const tex = new Texture({ source: new CanvasSource({ resource: canvas }) })
      const dark = new Sprite(tex)
      const lines = new Graphics(), rings = new Graphics(), doors = new Container(), preview = new Graphics()
      for (const c of [dark, lines, rings, preview]) c.eventMode = 'none'
      b.lightingC.addChild(dark, lines, rings, doors, preview)
      gfx.current = { dark, canvas, lit: document.createElement('canvas'), seen: document.createElement('canvas'), tex, lines, rings, doors, preview, geo: null, fog: null }
    })
    return () => { alive = false; gfx.current = null }
  }, [board, boardGen])

  // Ferramentas de parede, porta, luz e revelar.
  useEffect(() => {
    const b = board.current
    if (!b) return
    const snapPt = (p: { x: number; y: number }, free: boolean) => {
      // Ponta de parede perto vence o grid: sem isso sobra fresta no canto e a luz vaza.
      for (const { points: q } of st.current.walls) for (const i of [0, 2]) if (Math.hypot(q[i]! - p.x, q[i + 1]! - p.y) <= 12 / b.world.scale.x) return { x: q[i]!, y: q[i + 1]! }
      const g = st.current.scene?.grid
      if (!g || free || !g.show) return { x: Math.round(p.x), y: Math.round(p.y) }
      return { x: Math.round((p.x - g.offsetX) / g.size) * g.size + g.offsetX, y: Math.round((p.y - g.offsetY) / g.size) * g.size + g.offsetY }
    }
    const nearWall = (p: { x: number; y: number }) => {
      const tol = 12 / b.world.scale.x
      return st.current.walls.map((w) => ({ w, d: segDist(w.points[0]!, w.points[1]!, w.points[2]!, w.points[3]!, p.x, p.y) })).filter((x) => x.d <= tol).sort((a, c) => a.d - c.d)[0]?.w
    }
    const nearLight = (p: { x: number; y: number }) => st.current.lights.find((l) => Math.hypot(l.x - p.x, l.y - p.y) < 18 / b.world.scale.x)
    // Ponta da porta: no grid se isso cair sobre a parede; senão, no ponto da parede mais perto do cursor (mapa girado).
    const doorPt = (p: { x: number; y: number }, free: boolean) => {
      const s = snapPt(p, free), w = nearWall(p)
      if (!w) return s
      const [ax, ay, bx, by] = w.points as [number, number, number, number]
      if (segDist(ax, ay, bx, by, s.x, s.y) < 1) return s
      const k = Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
      return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k }
    }
    const sceneId = () => st.current.scene!.id
    const createWalls = (ws: Omit<Wall, 'id' | 'state'>[]) =>
      call<{ ids: string[] }>('wall:create', { sceneId: sceneId(), walls: ws }, (r) => ({ event: 'wall:delete', payload: { ids: r.ids } })).catch(onError)
    const moveLight = (l: Light, p: { x: number; y: number }) => void call('light:update', { id: l.id, patch: { x: p.x, y: p.y } }, { event: 'light:update', payload: { id: l.id, patch: { x: l.x, y: l.y } } }).catch(onError)
    // Alça (índice 0 ou 2 em points) da parede selecionada sob o cursor; -1 se nenhuma.
    const handleAt = (p: { x: number; y: number }) => {
      const w = st.current.walls.find((x) => x.id === st.current.sel)
      return { w, i: w ? [0, 2].find((i) => Math.hypot(w.points[i]! - p.x, w.points[i + 1]! - p.y) <= 12 / b.world.scale.x) ?? -1 : -1 }
    }
    // Paredes e portas que partem do mesmo canto vão junto, para o canto não abrir.
    const moveEnd = (w: Wall, i: number, p: { x: number; y: number }) => {
      const ox = w.points[i]!, oy = w.points[i + 1]!
      const moved = (x: Wall) => {
        const q = [...x.points]
        for (const k of [0, 2]) if (Math.hypot(q[k]! - ox, q[k + 1]! - oy) < 1) { q[k] = p.x; q[k + 1] = p.y }
        return q
      }
      const linked = st.current.walls.filter((x) => moved(x).some((v, k) => v !== x.points[k]))
      if (!linked.length || linked.some((x) => { const q = moved(x); return q[0] === q[2] && q[1] === q[3] })) return
      const send = (ws: Wall[], f: (x: Wall) => number[]) => Promise.all(ws.map((x) => request(socket, 'wall:update', { id: x.id, patch: { points: f(x) } })))
      call('wall:update', { id: w.id, patch: { points: moved(w) } }, () => send(linked, (x) => x.points)).then(() => send(linked.filter((x) => x.id !== w.id), moved)).catch(onError)
    }
    // Porta sobre parede não abre passagem nenhuma: a parede perde o trecho que fica sob a porta.
    const placeDoor = (p: { x: number; y: number }, q: { x: number; y: number }) => {
      const cuts = st.current.walls.flatMap((w) => { const rest = w.kind === 'wall' ? cutWall(w.points, p, q) : null; return rest ? [{ w, rest }] : [] })
      const old = cuts.map((c) => c.w)
      const ws = [...cuts.flatMap((c) => c.rest.map((points) => ({ points, kind: 'wall' as const }))), { points: [p.x, p.y, q.x, q.y], kind: 'door' as const }]
      call<{ ids: string[] }>('wall:create', { sceneId: sceneId(), walls: ws }, (r) => async () => {
        if (old.length) await request(socket, 'wall:create', { sceneId: sceneId(), walls: old })
        await request(socket, 'wall:delete', { ids: r.ids })
      }).then(() => old.length ? request(socket, 'wall:delete', { ids: old.map((w) => w.id) }) : null).catch(onError)
    }

    b.hooks.hover = (x, y, shift) => {
      const g = gfx.current
      if (!g) return
      const k = 1 / b.world.scale.x, t = st.current.tool, red = t === 'erase'
      g.preview.clear()
      if (t === 'wall' && chain.current) {
        const p = snapPt({ x, y }, !!shift)
        g.preview.moveTo(chain.current.x, chain.current.y).lineTo(p.x, p.y).stroke({ width: 3 * k, color: '#e5c07b', alpha: 0.7 })
      }
      if (!isGm || (t !== 'select' && t !== 'door' && t !== 'light' && t !== 'erase')) return
      // Mostra o que o clique vai pegar: o que será selecionado ou apagado, ou o trecho que vira porta.
      const l = t === 'door' ? null : nearLight({ x, y })
      if (l) return void g.preview.circle(l.x, l.y, 12 * k).stroke({ width: 3 * k, color: red ? '#d9534f' : '#e5c07b' })
      const w = t === 'light' ? null : nearWall({ x, y })
      if (!w) return
      const span = t === 'door' && w.kind === 'wall' ? doorSpan(w, { x, y }, st.current.scene?.grid.size || 70) : null
      const [ax, ay, bx, by] = span ? [span[0].x, span[0].y, span[1].x, span[1].y] : w.points
      g.preview.moveTo(ax!, ay!).lineTo(bx!, by!).stroke({ width: 8 * k, color: red ? '#d9534f' : '#e5c07b', alpha: 0.6 })
    }
    b.hooks.grab = (x, y) => isGm && (!!nearLight({ x, y }) || handleAt({ x, y }).i >= 0)
    b.hooks.moved = paintLight
    b.hooks.tool = (t, phase, a, end, mods) => {
      const g = gfx.current
      if (!st.current.scene || !g) return
      if (phase === 'drag' && end) {
        g.preview.clear()
        if (t === 'room' || t === 'reveal') {
          const p = t === 'room' ? snapPt(a, !!mods?.shift) : a, q = t === 'room' ? snapPt(end, !!mods?.shift) : end
          g.preview.rect(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.abs(q.x - p.x), Math.abs(q.y - p.y)).stroke({ width: 3 / b.world.scale.x, color: t === 'room' ? '#e5c07b' : '#5fbf7a' })
        }
        if (t === 'wall' || t === 'door') {
          const f = t === 'wall' ? snapPt : doorPt, p = f(a, !!mods?.shift), q = f(end, !!mods?.shift)
          g.preview.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: (t === 'wall' ? 3 : 5) / b.world.scale.x, color: '#e5c07b' })
        }
        if (t === 'select') {
          const { w, i } = handleAt(a)
          if (w && i >= 0) {
            const q = snapPt(end, !!mods?.shift)
            g.preview.moveTo(w.points[2 - i]!, w.points[3 - i]!).lineTo(q.x, q.y).stroke({ width: 5 / b.world.scale.x, color: '#e5c07b' })
            return
          }
        }
        if (t === 'light' || t === 'select') {
          const l = nearLight(a)
          if (l) g.preview.circle(end.x, end.y, 10 / b.world.scale.x).fill('#ffcc66')
        }
        return
      }
      g.preview.clear()
      if (t === 'select') {
        if (!isGm) return
        const { w, i } = handleAt(a), l = nearLight(a)
        if (end && w && i >= 0) return moveEnd(w, i, snapPt(end, !!mods?.shift))
        if (end && l) return moveLight(l, end)
        pick(l?.id ?? nearWall(a)?.id ?? null)
      } else if (t === 'erase') {
        if (!isGm) return
        const hit = nearLight(a) ?? nearWall(a)
        if (hit) remove(hit.id)
      } else if (t === 'wall') {
        if (mods?.alt && !end) { const w = nearWall(a); return void (w && remove(w.id)) }
        const p = snapPt(a, !!mods?.shift), q = end && snapPt(end, !!mods?.shift)
        // Mão que escorrega no clique cai no mesmo ponto do grid: continua sendo clique, não quebra a cadeia.
        const dragged = q && (q.x !== p.x || q.y !== p.y)
        const prev = dragged ? q : chain.current
        chain.current = dragged ? null : p
        if (prev && (prev.x !== p.x || prev.y !== p.y)) createWalls([{ points: [prev.x, prev.y, p.x, p.y], kind: 'wall' }])
      } else if (t === 'room' && end) {
        const p = snapPt(a, !!mods?.shift), q = snapPt(end, !!mods?.shift)
        if (p.x === q.x || p.y === q.y) return
        createWalls([[p.x, p.y, q.x, p.y], [q.x, p.y, q.x, q.y], [q.x, q.y, p.x, q.y], [p.x, q.y, p.x, p.y]].map((points) => ({ points, kind: 'wall' as const })))
      } else if (t === 'door') {
        if (end) {
          const p = doorPt(a, !!mods?.shift), q = doorPt(end, !!mods?.shift)
          if (p.x !== q.x || p.y !== q.y) placeDoor(p, q)
          return
        }
        const w = nearWall(a)
        if (!w) return
        if (mods?.alt) return remove(w.id)
        if (w.kind !== 'wall') return pick(w.id)
        const span = doorSpan(w, a, st.current.scene.grid.size || 70)
        if (span) return placeDoor(...span)
        call('wall:update', { id: w.id, patch: { kind: 'door' } }, { event: 'wall:update', payload: { id: w.id, patch: { kind: w.kind } } }).catch(onError)
      } else if (t === 'light') {
        const l = nearLight(a)
        if (l && mods?.alt && !end) return remove(l.id)
        if (l && !end) return pick(l.id)
        if (l && end) return moveLight(l, end)
        if (!l) {
          const gs = st.current.scene.grid.size || 70
          call<{ id: string }>('light:create', { sceneId: sceneId(), x: a.x, y: a.y, bright: gs * 4, dim: gs * 8, color: '#ffcc66' }, (r) => ({ event: 'light:delete', payload: { id: r.id } })).then((r) => pick(r.id, true)).catch(onError)
        }
      } else if (t === 'reveal' && end) {
        request(socket, 'fog:reveal', { sceneId: sceneId(), rect: [Math.min(a.x, end.x), Math.min(a.y, end.y), Math.abs(end.x - a.x), Math.abs(end.y - a.y)] }).catch(onError)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      // Controle deslizante do editor de luz fica de fora: com ele em foco, Del e Esc ainda valem para a seleção.
      if ((e.target as HTMLElement).closest('input:not([type=range]), textarea, select, dialog, [contenteditable]')) return
      // Com cadeia aberta ou item selecionado, Esc só desfaz isso; o Esc seguinte é que sai da ferramenta (table.tsx).
      if (e.key === 'Escape' && (chain.current || st.current.sel)) {
        chain.current = null
        pick(null)
        gfx.current?.preview.clear()
        e.stopImmediatePropagation()
      }
      // Antes do atalho de apagar token (table.tsx): seleção de mapa e de token nunca coexistem.
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.current.sel) {
        remove(st.current.sel)
        e.stopImmediatePropagation()
      }
      if (isGm && e.key.toLowerCase() === 'w' && !e.ctrlKey && !e.metaKey) setTool('wall')
    }
    // Captura: tem de rodar antes do atalho de table.tsx, para Esc e Del pararem aqui. A ordem de registro muda com o boardGen.
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); b.hooks = {} }
  }, [board, boardGen, call, onError, socket, isGm, setTool, pick, remove, paintLight])

  useEffect(() => { if (tool !== 'wall') chain.current = null; if (tool !== 'select' && tool !== 'door' && tool !== 'light') pick(null); gfx.current?.preview.clear() }, [tool, pick])
  useEffect(() => { if (selected.length !== 1) setViewAs(false); if (selected.length) pick(null) }, [selected, pick])

  // Redesenha escuridão, névoa, paredes e portas quando algo muda (um quadro por vez).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const g = gfx.current, b = board.current
      // Board recém-trocado: até o boardGen refazer as camadas, g ainda aponta para as destruídas.
      if (!g || !b || !scene || g.lines.destroyed) return
      drawWalls(g, b, walls, lights, isGm, sel)
      drawDoors(g, walls, scene, paintLight() ?? [], isGm, tool === 'select', (w, lock) => { if (isGm) pick(w.id); request(socket, 'door:toggle', { id: w.id, lock }).catch(onError) })
      // Ícone novo só ganha posição no render: sem isto, o clique que chega antes do próximo quadro passa direto.
      b.app.render()
    })
    return () => cancelAnimationFrame(id)
  }, [board, scene, walls, lights, tokens, fog, isGm, viewAs, selected, socket, onError, tool, sel, pick, paintLight])

  return { viewAs, setViewAs, pickedWall: walls.find((w) => w.id === sel), pickedLight: lights.find((l) => l.id === sel), editing, setEditing, remove }
}

// Opacidade do véu do mestre: o mapa escurece, mas segue legível. 0 = sem véu, 1 = breu como o do jogador.
const GM_VEIL = 0.6
const center = (t: TokenView, g: SceneView['grid']) => ({ x: t.x + (t.size * g.size) / 2, y: t.y + (t.size * g.size) / 2 })

function geometry(g: Gfx, walls: Wall[]) {
  if (g.geo?.walls !== walls) g.geo = { walls, sight: sightSegments(walls as WallLike[]), move: moveSegments(walls as WallLike[]), polys: new Map() }
  return g.geo
}

// Centro do token onde ele está agora na tela (arraste, deslize), sem esperar o servidor.
// `t` ainda é a posição confirmada: quem arrasta vê o que veria soltando ali, então a luz do jogador
// para na parede pela mesma regra do servidor (L6) e não dá para espiar a sala ao lado.
function liveCenter(b: Board, scene: SceneView, geo: Geo, isGm: boolean, reach: Map<string, { x: number; y: number }>): At {
  return (t) => {
    const from = center(t, scene.grid), e = b.tokens.get(t.id)
    if (!e) return from
    const half = (e.data.size * scene.grid.size) / 2
    const p = { x: Math.max(0, Math.min(scene.width - 1, e.c.x)) + half, y: Math.max(0, Math.min(scene.height - 1, e.c.y)) + half }
    if (!isGm && moveBlocked(from.x, from.y, p.x, p.y, geo.move)) return reach.get(t.id) ?? from
    reach.set(t.id, p)
    return p
  }
}

// Quem "enxerga" na tela: jogador vê pelos próprios tokens; mestre vê a união dos tokens de jogadores (véu) ou um token escolhido (L7).
function pickViewers(tokens: Map<string, TokenView>, at: At, isGm: boolean, asToken: string | null | undefined) {
  const list = [...tokens.values()].filter((t) => t.layer === 'tokens' && (asToken ? t.id === asToken : isGm ? t.pc : t.mine))
  return list.map((t) => ({ ...at(t), vision: t.vision, light: t.light }))
}

// Trecho de 1 quadrado da parede sob o clique. Parede curta: null (só troca o tipo).
function doorSpan(w: Wall, p: { x: number; y: number }, cell: number) {
  const [ax, ay, bx, by] = w.points as [number, number, number, number]
  const len = Math.hypot(bx - ax, by - ay)
  if (len < cell * 1.5) return null
  const along = ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / len
  // Parede reta casa com o quadrado do grid; na diagonal (mapa girado) não há quadrado, então centra no clique.
  const from = Math.max(0, Math.min(len - cell, ax === bx || ay === by ? Math.floor(along / cell) * cell : along - cell / 2))
  const at = (d: number) => ({ x: ax + ((bx - ax) * d) / len, y: ay + ((by - ay) * d) / len })
  return [at(from), at(from + cell)] as const
}

function drawWalls(g: Gfx, b: Board, walls: Wall[], lights: Light[], isGm: boolean, sel: string | null) {
  const s = b.world.scale.x
  g.lines.clear()
  if (!isGm) return
  for (const w of walls) {
    const color = w.kind === 'door' ? (w.state === 'locked' ? '#d9534f' : w.state === 'open' ? '#5fbf7a' : '#e5c07b') : w.kind === 'window' ? '#7fb3ff' : '#f0f0f0'
    g.lines.moveTo(w.points[0]!, w.points[1]!).lineTo(w.points[2]!, w.points[3]!).stroke({ width: (w.kind === 'wall' ? 3 : 5) / s, color, alpha: 0.9 })
  }
  for (const l of lights) {
    g.lines.circle(l.x, l.y, 8 / s).fill(l.color ?? '#ffcc66').circle(l.x, l.y, l.bright).stroke({ width: 1 / s, color: l.color ?? '#ffcc66', alpha: 0.4 }).circle(l.x, l.y, l.dim).stroke({ width: 1 / s, color: l.color ?? '#ffcc66', alpha: 0.2 })
  }
  // Selecionado: parede ganha contorno e alças nas pontas; luz ganha anel.
  const w = walls.find((x) => x.id === sel), l = lights.find((x) => x.id === sel)
  if (w) {
    const [ax, ay, bx, by] = w.points as [number, number, number, number]
    g.lines.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 7 / s, color: '#f2b544', alpha: 0.6 })
    for (const [x, y] of [[ax, ay], [bx, by]] as const) g.lines.circle(x, y, 7 / s).fill('#ffffff').stroke({ width: 2 / s, color: '#f2b544' })
  }
  if (l) g.lines.circle(l.x, l.y, 13 / s).stroke({ width: 3 / s, color: '#f2b544' })
}

// Token selecionado mostra até onde a luz dele chega.
function drawRings(g: Gfx, b: Board, isGm: boolean, carried: { x: number; y: number; bright: number; dim: number; color: string }[]) {
  const s = b.world.scale.x
  g.rings.clear()
  if (!isGm) return
  for (const l of carried) g.rings.circle(l.x, l.y, l.bright).stroke({ width: 2 / s, color: l.color, alpha: 0.7 }).circle(l.x, l.y, l.dim).stroke({ width: 2 / s, color: l.color, alpha: 0.35 })
}

// Portas clicáveis (L2): o jogador vê só as que estão à vista dos seus tokens.
function drawDoors(g: Gfx, walls: Wall[], scene: SceneView, viewers: { x: number; y: number }[], isGm: boolean, clickable: boolean, toggle: (w: Wall, lock?: boolean) => void) {
  g.doors.removeChildren().forEach((c) => c.destroy())
  const sight = sightSegments(walls as WallLike[])
  const polys = isGm ? [] : viewers.map((v) => ({ v, poly: visibilityPolygon(v.x, v.y, sight, scene.width, scene.height) }))
  for (const w of walls) {
    if (w.kind !== 'door') continue
    const mx = (w.points[0]! + w.points[2]!) / 2, my = (w.points[1]! + w.points[3]!) / 2
    if (!isGm && scene.dungeon && !polys.some(({ v, poly }) => {
      const d = Math.hypot(v.x - mx, v.y - my) || 1
      return pointInPolygon(poly, mx + ((v.x - mx) / d) * 6, my + ((v.y - my) / d) * 6)
    })) continue
    const r = Math.max(10, (scene.grid.size || 70) * 0.18)
    const icon = new Graphics().circle(0, 0, r).fill({ color: '#262c3b', alpha: 0.9 }).stroke({ width: 2, color: w.state === 'open' ? '#5fbf7a' : w.state === 'locked' ? '#d9534f' : '#e5c07b' })
    icon.rect(-r * 0.35, -r * 0.5, r * 0.7, r).stroke({ width: 2, color: '#ffffff' })
    icon.position.set(mx, my)
    // Com outra ferramenta (a de porta, por exemplo) o clique atravessa o ícone e chega na parede.
    icon.eventMode = clickable ? 'static' : 'none'
    icon.cursor = 'pointer'
    icon.on('pointerdown', (e) => { e.stopPropagation(); toggle(w, isGm && e.altKey ? w.state !== 'locked' : undefined) })
    g.doors.addChild(icon)
  }
}

// Escuridão: para o jogador, breu fora do que os tokens enxergam agora, inclusive onde já passou; cinza só no revelado à mão (L3–L5).
// Para o mestre (gm) é a mesma conta sob um véu translúcido: limpo é o que os jogadores enxergam agora, escurecido é o que não enxergam.
function drawDarkness(g: Gfx, geo: Geo, scene: SceneView, lights: Light[], tokens: Map<string, TokenView>, at: At, viewers: ReturnType<typeof pickViewers>, fog: FogData | null, gm: boolean) {
  g.dark.visible = scene.dungeon
  if (!scene.dungeon) return
  const k = Math.min(1, 2048 / Math.max(scene.width, scene.height))
  const c = g.canvas
  if (c.width !== Math.ceil(scene.width * k) || c.height !== Math.ceil(scene.height * k)) {
    c.width = Math.ceil(scene.width * k)
    c.height = Math.ceil(scene.height * k)
    // A textura guarda o tamanho do canvas de quando foi criada; com outro tamanho, cria de novo.
    g.tex.destroy()
    g.tex = new Texture({ source: new CanvasSource({ resource: c }) })
    g.dark.texture = g.tex
  }
  const ctx = c.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, c.width, c.height)
  if (fog) {
    if (g.fog?.of !== fog) g.fog = { of: fog, canvas: fogCanvas(fog) }
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(g.fog.canvas, 0, 0, fog.cols * fog.cell * k, fog.rows * fog.cell * k)
  } else {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, c.width, c.height)
  }
  const carried = [...tokens.values()].filter((t) => t.light && t.layer === 'tokens').map((t) => ({ ...at(t), bright: t.light!.bright, dim: t.light!.dim }))
  const sources = [...lights.map((l) => ({ x: l.x, y: l.y, bright: l.bright, dim: Math.max(l.dim, l.bright) })), ...carried]
  // Só o polígono de quem andou é recalculado; o resto vem do quadro anterior.
  const polys = new Map<string, number[]>()
  const polyAt = (x: number, y: number) => {
    const key = `${x},${y}`
    const poly = polys.get(key) ?? geo.polys.get(key) ?? visibilityPolygon(x, y, geo.sight, scene.width, scene.height)
    polys.set(key, poly)
    return poly
  }
  const clipTo = (x: CanvasRenderingContext2D, poly: number[]) => {
    x.beginPath()
    x.moveTo(poly[0]!, poly[1]!)
    for (let i = 2; i < poly.length; i += 2) x.lineTo(poly[i]!, poly[i + 1]!)
    x.closePath()
    x.clip()
  }
  // Luz e visão em máscaras separadas: cada ponto recebe cada luz uma vez. Recortar a luz token por token
  // somava claridade onde dois tokens enxergam o mesmo lugar, e a sombra de um aparecia como cunha na luz do outro.
  const lit = mask(g.lit, c, k), seen = mask(g.seen, c, k)
  for (const l of sources) {
    lit.save()
    clipTo(lit, polyAt(l.x, l.y))
    radial(lit, l.x, l.y, l.bright, l.dim)
    lit.restore()
  }
  for (const v of viewers) {
    const poly = polyAt(v.x, v.y)
    if (v.vision?.dark) { lit.save(); clipTo(lit, poly); radial(lit, v.x, v.y, v.vision.dark, v.vision.dark); lit.restore() }
    seen.save()
    clipTo(seen, poly)
    if (v.vision?.range) { seen.beginPath(); seen.arc(v.x, v.y, v.vision.range, 0, Math.PI * 2); seen.clip() }
    seen.fillRect(0, 0, scene.width, scene.height)
    seen.restore()
  }
  // Luz de um lado da parede e visão do outro se tocam exatamente nela: sem isto, sobra um fio de luz no preto.
  seen.globalCompositeOperation = 'destination-out'
  seen.lineWidth = 2 / k
  seen.beginPath()
  for (const [ax, ay, bx, by] of geo.sight) { seen.moveTo(ax, ay); seen.lineTo(bx, by) }
  seen.stroke()
  lit.setTransform(1, 0, 0, 1, 0, 0)
  lit.globalCompositeOperation = 'destination-in'
  lit.drawImage(g.seen, 0, 0)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.drawImage(g.lit, 0, 0)
  geo.polys = polys
  g.dark.alpha = gm ? GM_VEIL : 1
  g.dark.scale.set(1 / k)
  g.tex.source.update()
}

// Máscara do tamanho da escuridão, limpa e em coordenadas do mapa.
function mask(canvas: HTMLCanvasElement, like: HTMLCanvasElement, k: number) {
  if (canvas.width !== like.width || canvas.height !== like.height) { canvas.width = like.width; canvas.height = like.height }
  const x = canvas.getContext('2d')!
  x.setTransform(1, 0, 0, 1, 0, 0)
  x.globalCompositeOperation = 'source-over'
  x.clearRect(0, 0, canvas.width, canvas.height)
  x.setTransform(k, 0, 0, k, 0, 0)
  return x
}

function fogCanvas(fog: FogData) {
  const small = document.createElement('canvas')
  small.width = fog.cols
  small.height = fog.rows
  const sctx = small.getContext('2d')!
  const img = sctx.createImageData(fog.cols, fog.rows)
  const bits = unpackBits(Uint8Array.from(atob(fog.reveal), (ch) => ch.charCodeAt(0)), fog.cols * fog.rows)
  for (let i = 0; i < bits.length; i++) img.data[i * 4 + 3] = bits[i] ? 165 : 255
  sctx.putImageData(img, 0, 0)
  return small
}

// Luz clara apaga a escuridão por inteiro; a penumbra deixa um pouco.
function radial(ctx: CanvasRenderingContext2D, x: number, y: number, bright: number, dim: number) {
  const r = Math.max(bright, dim, 1)
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
  grad.addColorStop(0, 'rgba(0,0,0,1)')
  grad.addColorStop(Math.min(0.999, bright / r), 'rgba(0,0,0,1)')
  grad.addColorStop(Math.min(1, bright / r + 0.001), 'rgba(0,0,0,0.6)')
  grad.addColorStop(1, 'rgba(0,0,0,0.45)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}
