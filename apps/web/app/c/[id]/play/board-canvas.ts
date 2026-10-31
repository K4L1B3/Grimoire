// Canvas do tabuleiro em PixiJS (ADR-7). Imperativo: o React entrega dados e recebe intenções (mover, desenhar, pingar…).
import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js'
import { dynamicIconImports, type IconName } from 'lucide-react/dynamic'
import { effectOf } from '@grimorio/core'
import { cells, pathCells, snap, type Grid } from '@grimorio/core'

export type TokenView = {
  id: string; actorId: string | null; name: string; image: string | null; x: number; y: number; size: number; layer: 'tokens' | 'gm'
  conditions: string[]; bars: { v: number; m: number | null; color: string }[]; mine: boolean; pc: boolean; speed: number | null; sheetId: string | null
  stats: { hp: number | null; hpMax: number | null; ac: number | null; defense: number | null; dc: number | null }
  vision: { range: number; dark: number } | null; light: { bright: number; dim: number; color: string } | null
}
export type DrawingView = { id: string; points: number[]; color: string; width: number; layer: 'tokens' | 'gm' }
export type SceneView = { id: string; name: string; image: string | null; width: number; height: number; grid: Grid; active: boolean; dungeon: boolean }
export type Tool = 'select' | 'pan' | 'ruler' | 'draw' | 'erase' | 'pin' | 'align' | 'wall' | 'door' | 'room' | 'light' | 'reveal'

export type BoardEvents = {
  moveToken(id: string, x: number, y: number, path: number[]): void
  resizeToken?(id: string, size: number): void
  select(ids: string[]): void
  openToken(id: string): void
  draw(points: number[]): void
  erase(ids: string[]): void
  ping(x: number, y: number): void
  pin(x: number, y: number): void
  align(size: number, offsetX: number, offsetY: number): void
  view(x: number, y: number, scale: number): void
  // Ferramentas de parede/luz (fase 5) entram por aqui também.
  tool?(tool: Tool, phase: 'click' | 'drag', a: { x: number; y: number }, b?: { x: number; y: number }, e?: { shift: boolean; alt: boolean }): void
  speedOf?(tokenId: string): { moved: number; max: number | null } | null
  hover?(x: number, y: number, shift?: boolean): void
  // Cursor entrou num token (ou saiu, com null), sem botão apertado.
  hoverToken?(id: string | null): void
  // Com a seta: true se o que está sob o cursor é arrastável (luz, alça de parede); aí não abre seleção de área.
  grab?(x: number, y: number): boolean
  // Algum token mudou de lugar na tela neste quadro (arraste, deslize).
  moved?(): void
}

const textures = new Map<string, Promise<Texture>>()
function texture(url: string) {
  if (!textures.has(url)) {
    textures.set(url, new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'use-credentials'
      img.onload = () => resolve(Texture.from(img))
      img.onerror = reject
      img.src = url
    }))
  }
  return textures.get(url)!
}

// O canvas não desenha componentes React: monta o SVG branco do ícone a partir dos traços do lucide.
async function iconTexture(name: IconName) {
  const { __iconData } = await dynamicIconImports[name]() as unknown as { __iconData: { node: [string, Record<string, string>][] } }
  const shapes = __iconData.node.map(([tag, { key: _key, ...attrs }]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('')
  return texture(`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`)}`)
}

export class Board {
  app = new Application()
  world = new Container()
  bg = new Sprite()
  gridG = new Graphics()
  drawingsC = new Container()
  tokensC = new Container({ sortableChildren: true })
  /** Camadas de luz e névoa (fase 5) ficam entre tokens e sobreposições. */
  lightingC = new Container()
  overlay = new Graphics()
  overlayText = new Text({ text: '', style: { fill: '#ffffff', fontSize: 16, fontWeight: '600', stroke: { color: '#000000', width: 4 } } })
  pingsC = new Container()
  scene: SceneView | null = null
  tokens = new Map<string, { c: Container; data: TokenView; sprite: Sprite; ring: Graphics; extras: Container }>()
  drawings = new Map<string, { g: Graphics; data: DrawingView }>()
  selected = new Set<string>()
  turnToken: string | null = null
  tool: Tool = 'select'
  drawColor = '#e5c07b'
  isGm = false
  ready: Promise<void>
  private destroyed = false

  private el: HTMLElement
  private on: BoardEvents
  // Ganchos que outros módulos (luz e paredes) registram depois de criado o Board.
  hooks: Partial<Pick<BoardEvents, 'tool' | 'hover' | 'grab' | 'moved'>> = {}

  constructor(el: HTMLElement, on: BoardEvents) {
    this.el = el
    this.on = on
    this.ready = this.init()
    // Testes E2E leem a câmera para clicar em coordenadas do mapa.
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __board?: Board }).__board = this
  }

  private async init() {
    await this.app.init({ resizeTo: this.el, background: '#141824', antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 })
    if (this.destroyed) return void this.app.destroy(true)
    // ponytail: o Pixi redesenha todo quadro, mesmo com a mesa parada; se pesar, trocar por render sob demanda.
    this.app.ticker.maxFPS = IDLE_FPS
    this.el.appendChild(this.app.canvas)
    // resizeTo só escuta a janela do navegador; painéis da tela dividida e o chat mudam a mesa sem disparar esse evento.
    this.sizeObserver = new ResizeObserver(() => this.app.queueResize())
    this.sizeObserver.observe(this.el)
    this.app.canvas.style.touchAction = 'none'
    this.world.addChild(this.bg, this.gridG, this.drawingsC, this.tokensC, this.lightingC, this.overlay, this.overlayText, this.pingsC)
    // Com o palco interativo, até camada "passiva" tapa o clique em quem está embaixo: só desenho fica de fora do hit test.
    for (const c of [this.overlay, this.overlayText, this.pingsC]) c.eventMode = 'none'
    this.app.stage.addChild(this.world)
    this.app.stage.eventMode = 'static'
    this.app.stage.hitArea = this.app.screen
    this.app.stage.on('pointerdown', (e) => this.stageDown(e))
    this.app.stage.on('pointermove', (e) => {
      if (e.buttons) this.hot = performance.now()
      else if (this.hooks.hover) { const w = this.toWorld(e.clientX, e.clientY); this.hooks.hover(w.x, w.y, e.shiftKey) }
    })
    this.app.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false })
    this.app.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    this.app.ticker.add(this.tick)
    window.addEventListener('keydown', this.spaceKey)
    window.addEventListener('keyup', this.spaceKey)
  }

  private sizeObserver?: ResizeObserver
  private space = false
  private spaceKey =(e: KeyboardEvent) => {
    if (e.code === 'Space' && !(e.target as HTMLElement).closest('input, textarea, [contenteditable]')) this.space = e.type === 'keydown'
  }

  // Token que o servidor moveu desliza até o destino em vez de teleportar; quem desenha luz é avisado uma vez por quadro.
  private moved = false
  private hot = 0
  private calm = matchMedia('(prefers-reduced-motion: reduce)')
  private tick = () => {
    const k = this.calm.matches ? 1 : 1 - Math.exp(-this.app.ticker.deltaMS / GLIDE_MS)
    for (const [id, { c, data }] of this.tokens) {
      if ((c.x === data.x && c.y === data.y) || this.dragging?.ids.includes(id)) continue
      const arrived = Math.hypot(data.x - c.x, data.y - c.y) < 1
      c.position.set(arrived ? data.x : c.x + (data.x - c.x) * k, arrived ? data.y : c.y + (data.y - c.y) * k)
      this.moved = true
    }
    if (this.moved) { this.moved = false; this.hot = performance.now(); this.hooks.moved?.() }
    // Parada, a mesa poupa a máquina; com algo andando, vai ao máximo da tela.
    this.app.ticker.maxFPS = performance.now() - this.hot < HOT_MS ? 0 : IDLE_FPS
  }

  destroy() {
    this.destroyed = true
    this.sizeObserver?.disconnect()
    window.removeEventListener('keydown', this.spaceKey)
    window.removeEventListener('keyup', this.spaceKey)
    if (this.app.renderer) this.app.destroy(true, { children: true })
  }

  /** Foto do que está na tela. Sem mapa carregado não há o que mostrar no cartão da campanha. */
  snapshot(width: number) {
    // Em dev o Strict Mode desmonta a mesa antes de o Pixi terminar de iniciar; até lá app.screen nem existe.
    if (!this.app.renderer) return null
    const { screen } = this.app
    if (this.bg.texture === Texture.EMPTY || !screen.width) return null
    return this.app.renderer.extract.canvas({ target: this.app.stage, frame: new Rectangle(0, 0, screen.width, screen.height), resolution: width / screen.width, clearColor: '#141824' }) as HTMLCanvasElement
  }

  // --- coordenadas e câmera ---
  toWorld(sx: number, sy: number) {
    const r = this.app.canvas.getBoundingClientRect()
    return { x: (sx - r.left - this.world.x) / this.world.scale.x, y: (sy - r.top - this.world.y) / this.world.scale.y }
  }

  private emitView() {
    this.hot = performance.now()
    this.on.view(this.world.x, this.world.y, this.world.scale.x)
  }

  fit() {
    if (!this.scene) return
    const { width, height } = this.app.screen
    const s = Math.min(width / this.scene.width, height / this.scene.height) * 0.95
    this.world.scale.set(s)
    this.world.position.set((width - this.scene.width * s) / 2, (height - this.scene.height * s) / 2)
    this.emitView()
  }

  centerOn(x: number, y: number) {
    const { width, height } = this.app.screen
    this.world.position.set(width / 2 - x * this.world.scale.x, height / 2 - y * this.world.scale.y)
    this.emitView()
  }

  private wheel(e: WheelEvent) {
    e.preventDefault()
    const r = this.app.canvas.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const old = this.world.scale.x
    const s = Math.min(8, Math.max(0.05, old * Math.exp(-e.deltaY * 0.0015)))
    this.world.position.set(mx - ((mx - this.world.x) * s) / old, my - ((my - this.world.y) * s) / old)
    this.world.scale.set(s)
    this.emitView()
  }

  // --- cena e grid ---
  async setScene(sc: SceneView) {
    await this.ready
    const changed = this.scene?.id !== sc.id
    this.scene = sc
    if (sc.image) texture(`/api/assets/${sc.image}`).then((t) => { if (this.scene?.image === sc.image) { this.bg.texture = t; this.bg.width = sc.width; this.bg.height = sc.height } }).catch(() => {})
    else this.bg.texture = Texture.EMPTY
    this.drawGrid()
    if (changed) {
      for (const id of [...this.tokens.keys()]) this.removeToken(id)
      for (const id of [...this.drawings.keys()]) this.removeDrawing(id)
      this.fit()
    }
  }

  drawGrid() {
    const sc = this.scene
    const g = this.gridG.clear()
    if (!sc?.grid.show) return
    const { size, offsetX, offsetY, color } = sc.grid
    const c = color.slice(0, 7), alpha = color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 0.3
    for (let x = offsetX % size; x <= sc.width; x += size) g.moveTo(x, 0).lineTo(x, sc.height)
    for (let y = offsetY % size; y <= sc.height; y += size) g.moveTo(0, y).lineTo(sc.width, y)
    g.stroke({ width: 1, color: c, alpha, pixelLine: true })
  }

  // --- tokens ---
  upsertToken(t: TokenView) {
    let e = this.tokens.get(t.id)
    if (!e) {
      const c = new Container({ x: t.x, y: t.y })
      const sprite = new Sprite()
      const ring = new Graphics()
      const extras = new Container()
      c.addChild(sprite, ring, extras)
      c.eventMode = 'static'
      c.cursor = 'pointer'
      c.on('pointerdown', (ev) => this.tokenDown(ev, t.id))
      c.on('pointerenter', (ev) => { if (!ev.buttons) this.on.hoverToken?.(t.id) })
      c.on('pointerleave', () => this.on.hoverToken?.(null))
      this.tokensC.addChild(c)
      e = { c, data: t, sprite, ring, extras }
      this.tokens.set(t.id, e)
    }
    const prevImage = e.data.image
    e.data = t
    if (t.image && (t.image !== prevImage || e.sprite.texture === Texture.EMPTY)) texture(`/api/assets/${t.image}`).then((tx) => { e.sprite.texture = tx; this.layoutToken(t.id) }).catch(() => {})
    if (!t.image) e.sprite.texture = Texture.EMPTY
    this.layoutToken(t.id)
  }

  private layoutToken(id: string) {
    const e = this.tokens.get(id)
    if (!e || !this.scene) return
    const t = e.data
    const px = this.scene.grid.size * t.size
    e.c.zIndex = t.layer === 'gm' ? 1 : 2
    e.c.alpha = t.layer === 'gm' ? 0.6 : 1
    const tex = e.sprite.texture
    if (tex !== Texture.EMPTY) {
      const s = Math.min(px / tex.width, px / tex.height)
      e.sprite.scale.set(s)
      e.sprite.position.set((px - tex.width * s) / 2, (px - tex.height * s) / 2)
    }
    const sel = this.selected.has(id), turn = this.turnToken === id
    e.ring.clear()
    if (tex === Texture.EMPTY) e.ring.circle(px / 2, px / 2, px * 0.45).fill({ color: t.layer === 'gm' ? '#7a5a9a' : '#3b5a7a' })
    e.ring.circle(px / 2, px / 2, px * 0.47).stroke({ width: turn ? 5 : sel ? 4 : 2, color: turn ? '#5fbf7a' : sel ? '#c9a24a' : '#00000088' })
    e.extras.removeChildren().forEach((c) => c.destroy())
    if (tex === Texture.EMPTY && t.name) {
      const init = new Text({ text: t.name.slice(0, 2).toUpperCase(), style: { fill: '#ffffff', fontSize: px * 0.32, fontWeight: '700' } })
      init.anchor.set(0.5)
      init.position.set(px / 2, px / 2)
      e.extras.addChild(init)
    }
    // Barras (T5) em cima do token.
    t.bars.forEach((b, i) => {
      const g = new Graphics()
      const w = px * 0.9, h = Math.max(4, px * 0.07), y = -h * (i + 1) - 2 * i - 2
      const frac = b.m ? Math.max(0, Math.min(1, b.v / b.m)) : 1
      g.rect(px * 0.05, y, w, h).fill({ color: '#000000', alpha: 0.6 }).rect(px * 0.05, y, w * frac, h).fill({ color: b.color })
      e.extras.addChild(g)
    })
    // Efeitos (T5, C5): selo com ícone por cima do token, até 3 por linha; condição fora da lista vira texto.
    const conds = t.conditions.map(effectOf)
    const icons = conds.flatMap((c) => (c.effect ? [{ ...c.effect, rounds: c.rounds }] : [])).slice(0, 9)
    const badge = px * 0.3
    icons.forEach((fx, i) => {
      const b = new Container({ x: px * 0.05 + (i % 3) * badge, y: px * 0.02 + Math.floor(i / 3) * badge })
      const icon = new Sprite({ x: badge * 0.17, y: badge * 0.17 })
      b.addChild(new Graphics().circle(badge / 2, badge / 2, badge * 0.47).fill({ color: fx.color }).stroke({ width: Math.max(1, badge * 0.05), color: '#000000', alpha: 0.6 }), icon)
      if (fx.rounds) {
        const n = new Text({ text: fx.rounds, style: { fill: '#ffffff', fontSize: badge * 0.42, fontWeight: '700', stroke: { color: '#000000', width: 3 } } })
        n.anchor.set(1)
        n.position.set(badge, badge)
        b.addChild(n)
      }
      e.extras.addChild(b)
      iconTexture(fx.icon).then((tx) => { if (!icon.destroyed) { icon.texture = tx; icon.setSize(badge * 0.66) } }).catch(() => {})
    })
    const iconRows = Math.ceil(icons.length / 3)
    conds.filter((c) => !c.effect).slice(0, 4).forEach((c, i) => {
      const tag = new Text({ text: c.rounds ? `${c.name} (${c.rounds})` : c.name, style: { fill: '#ffffff', fontSize: Math.max(10, px * 0.16), stroke: { color: '#000000', width: 3 } } })
      tag.position.set(px * 0.02, px * 0.02 + iconRows * badge + i * tag.height * 0.9)
      e.extras.addChild(tag)
    })
    if (sel || turn) {
      const name = new Text({ text: t.name, style: { fill: '#ffffff', fontSize: Math.max(12, px * 0.2), stroke: { color: '#000000', width: 4 } } })
      name.anchor.set(0.5, 0)
      name.position.set(px / 2, px + 2)
      e.extras.addChild(name)
    }
    // Alça de tamanho: mestre ou dono arrasta o canto e o token cresce em células inteiras.
    if (sel && (this.isGm || t.mine) && this.selected.size === 1 && this.on.resizeToken) {
      const h = Math.max(10, 14 / this.world.scale.x)
      const handle = new Graphics().roundRect(px - h / 2, px - h / 2, h, h, h / 4).fill('#f2b544').stroke({ width: 2, color: '#1b1f2b' })
      handle.eventMode = 'static'
      handle.cursor = 'nwse-resize'
      handle.on('pointerdown', (ev) => this.resizeStart(ev, id))
      e.extras.addChild(handle)
    }
  }

  private resizeStart(ev: FederatedPointerEvent, id: string) {
    ev.stopPropagation()
    const e = this.tokens.get(id)
    if (!e || !this.scene) return
    const g = this.scene.grid.size, start = e.data.size
    const move = (pe: PointerEvent) => {
      const w = this.toWorld(pe.clientX, pe.clientY)
      const size = Math.max(1, Math.min(20, Math.round(Math.max(w.x - e.data.x, w.y - e.data.y) / g)))
      if (size !== e.data.size) { e.data = { ...e.data, size }; this.layoutToken(id); this.moved = true }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', () => {
      window.removeEventListener('pointermove', move)
      if (e.data.size !== start) this.on.resizeToken?.(id, e.data.size)
    }, { once: true })
  }

  removeToken(id: string) {
    const e = this.tokens.get(id)
    if (!e) return
    e.c.destroy({ children: true })
    this.tokens.delete(id)
    this.selected.delete(id)
  }

  setSelected(ids: Iterable<string>) {
    const before = new Set(this.selected)
    this.selected = new Set(ids)
    for (const id of new Set([...before, ...this.selected])) this.layoutToken(id)
  }

  setTurn(tokenId: string | null) {
    const prev = this.turnToken
    this.turnToken = tokenId
    if (prev) this.layoutToken(prev)
    if (tokenId) this.layoutToken(tokenId)
  }

  // --- desenhos (T9) ---
  upsertDrawing(d: DrawingView) {
    this.drawings.get(d.id)?.g.destroy()
    const g = new Graphics()
    g.moveTo(d.points[0]!, d.points[1]!)
    for (let i = 2; i < d.points.length; i += 2) g.lineTo(d.points[i]!, d.points[i + 1]!)
    g.stroke({ width: d.width, color: d.color, cap: 'round', join: 'round', alpha: d.layer === 'gm' ? 0.6 : 1 })
    this.drawingsC.addChild(g)
    this.drawings.set(d.id, { g, data: d })
  }

  removeDrawing(id: string) {
    this.drawings.get(id)?.g.destroy()
    this.drawings.delete(id)
  }

  // --- ping (T8) ---
  ping(x: number, y: number, color = '#c9a24a') {
    const g = new Graphics()
    this.pingsC.addChild(g)
    const start = performance.now()
    const tick = () => {
      const t = (performance.now() - start) / 1600
      if (t >= 1 || g.destroyed) return void (this.app.ticker.remove(tick), g.destroy())
      const r = (40 + 120 * ((t * 2) % 1)) / this.world.scale.x
      g.clear().circle(x, y, r).stroke({ width: 4 / this.world.scale.x, color, alpha: 1 - t }).circle(x, y, 10 / this.world.scale.x).fill({ color, alpha: 1 - t })
    }
    this.app.ticker.add(tick)
  }

  // --- interação ---
  private shiftHeld = false
  private dragging: { id: string; ox: number; oy: number; path: number[]; start: { x: number; y: number }; ids: string[]; origins: Map<string, { x: number; y: number }> } | null = null

  private tokenDown(e: FederatedPointerEvent, id: string) {
    if (e.button !== 0) return
    this.on.hoverToken?.(null)
    const t = this.tokens.get(id)!.data
    if (this.tool === 'pan' || this.tool === 'erase' || this.tool === 'ruler' || this.tool === 'draw' || this.tool === 'wall' || this.tool === 'room' || this.tool === 'door' || this.tool === 'light' || this.tool === 'align' || this.tool === 'reveal') return
    e.stopPropagation()
    if (e.detail === 2) return this.on.openToken(id)
    this.shiftHeld = e.shiftKey
    const next = e.shiftKey ? new Set(this.selected) : this.selected.has(id) ? new Set(this.selected) : new Set<string>()
    if (e.shiftKey && next.has(id)) next.delete(id)
    else next.add(id)
    this.setSelected(next)
    this.on.select([...next])
    if (!t.mine && !this.isGm) return
    const w = this.toWorld(e.clientX, e.clientY)
    const ids = [...next].filter((k) => this.tokens.get(k)?.data.mine || this.isGm)
    this.dragging = { id, ox: w.x - t.x, oy: w.y - t.y, path: [t.x, t.y], start: { x: t.x, y: t.y }, ids, origins: new Map(ids.map((k) => [k, { x: this.tokens.get(k)!.data.x, y: this.tokens.get(k)!.data.y }])) }
    const move = (ev: PointerEvent) => this.dragMove(ev)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', () => { window.removeEventListener('pointermove', move); this.dragEnd() }, { once: true })
  }

  private dragMove(ev: PointerEvent) {
    const d = this.dragging
    if (!d || !this.scene) return
    const w = this.toWorld(ev.clientX, ev.clientY)
    const x = w.x - d.ox, y = w.y - d.oy
    const dx = x - d.start.x, dy = y - d.start.y
    for (const k of d.ids) {
      const o = d.origins.get(k)!
      this.tokens.get(k)?.c.position.set(o.x + dx, o.y + dy)
    }
    this.moved = true
    const g = this.scene.grid
    const sx = place(x, g, g.offsetX), sy = place(y, g, g.offsetY)
    const [lx, ly] = d.path.slice(-2) as [number, number]
    // Sem grid a posição muda a cada pixel: um ponto por célula andada, ou o caminho estoura o limite do token:move.
    if (g.show ? sx !== lx || sy !== ly : Math.hypot(sx - lx, sy - ly) >= g.size) d.path.push(sx, sy)
    const trail = [...d.path, sx, sy]
    // Régua do arraste (C8): distância andada e o quanto resta do deslocamento do turno.
    const half = (this.tokens.get(d.id)!.data.size * g.size) / 2
    const dist = pathCells(trail, g)
    const speed = this.on.speedOf?.(d.id)
    const total = dist + (speed?.moved ?? 0)
    const over = speed?.max != null && total > speed.max
    this.overlay.clear().moveTo(trail[0]! + half, trail[1]! + half)
    for (let i = 2; i < trail.length; i += 2) this.overlay.lineTo(trail[i]! + half, trail[i + 1]! + half)
    this.overlay.stroke({ width: 4 / this.world.scale.x, color: over ? '#d9534f' : '#c9a24a', alpha: 0.9 })
    this.label(sx + half, sy - 10 / this.world.scale.x, this.measure(dist) + (speed?.max != null ? ` · ${this.fmt(total * g.unit)} / ${this.fmt(speed.max * g.unit)} m` : ''), over)
  }

  private dragEnd() {
    const d = this.dragging
    this.dragging = null
    this.moved = true
    this.overlay.clear()
    this.overlayText.text = ''
    if (!d || !this.scene) return
    const g = this.scene.grid
    const main = this.tokens.get(d.id)!.c
    const nx = place(main.x, g, g.offsetX), ny = place(main.y, g, g.offsetY)
    const dx = nx - d.start.x, dy = ny - d.start.y
    // Sem encaixe, a mão que treme no clique não pode virar movimento.
    if (Math.hypot(dx, dy) * this.world.scale.x <= 5) {
      for (const k of d.ids) { const o = d.origins.get(k)!; this.tokens.get(k)?.c.position.set(o.x, o.y) }
      // Clique sem arrastar num token do grupo: fica só ele selecionado (e a barra mostra as ações dele).
      if (this.selected.size > 1 && !this.shiftHeld) { this.setSelected([d.id]); this.on.select([d.id]) }
      return
    }
    for (const k of d.ids) {
      const o = d.origins.get(k)!
      const e = this.tokens.get(k)
      if (!e) continue
      e.c.position.set(o.x + dx, o.y + dy)
      e.data = { ...e.data, x: o.x + dx, y: o.y + dy }
      this.on.moveToken(k, o.x + dx, o.y + dy, k === d.id ? [...d.path, nx, ny] : [o.x, o.y, o.x + dx, o.y + dy])
    }
  }

  // Volta o token para onde o servidor diz que ele está (movimento recusado).
  revert(id: string, x: number, y: number) {
    const e = this.tokens.get(id)
    if (e) e.data = { ...e.data, x, y }
  }

  private measure(c: number) {
    const g = this.scene!.grid
    return `${this.fmt(c)} ${c === 1 ? 'quadrado' : 'quadrados'}${g.unit ? ` · ${this.fmt(c * g.unit)} m` : ''}`
  }
  private fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('pt-BR')

  private label(x: number, y: number, text: string, warn = false) {
    this.overlayText.text = text
    this.overlayText.style.fill = warn ? '#ff8a80' : '#ffffff'
    this.overlayText.scale.set(1 / this.world.scale.x)
    this.overlayText.anchor.set(0.5, 1)
    this.overlayText.position.set(x, y)
  }

  private stageDown(e: FederatedPointerEvent) {
    const start = this.toWorld(e.clientX, e.clientY)
    const sx = e.clientX, sy = e.clientY
    let moved = false
    // Botão do meio/direito (ou espaço + esquerdo, ou a mão + esquerdo) arrasta a câmera; com a seleção, o esquerdo no vazio marca uma área.
    const pan = e.button === 1 || e.button === 2 || ((this.space || this.tool === 'pan') && e.button === 0)
    const grabbed = this.tool === 'select' && e.button === 0 && !pan && !!this.hooks.grab?.(start.x, start.y)
    const marquee = this.tool === 'select' && e.button === 0 && !pan && !grabbed
    const wx = this.world.x, wy = this.world.y
    const pts: number[] = [start.x, start.y]
    const pingTimer = e.button === 0 && !grabbed && (this.tool === 'select' || this.tool === 'ruler') ? setTimeout(() => !moved && this.on.ping(start.x, start.y), 550) : null
    if (marquee && !e.shiftKey) { this.setSelected([]); this.on.select([]) }

    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) moved = true
      if (pan) {
        this.world.position.set(wx + ev.clientX - sx, wy + ev.clientY - sy)
        return this.emitView()
      }
      const w = this.toWorld(ev.clientX, ev.clientY)
      if (marquee) {
        if (moved) this.overlay.clear().rect(Math.min(start.x, w.x), Math.min(start.y, w.y), Math.abs(w.x - start.x), Math.abs(w.y - start.y)).fill({ color: '#f2b544', alpha: 0.12 }).stroke({ width: 2 / this.world.scale.x, color: '#f2b544' })
      } else if (this.tool === 'ruler' && this.scene) {
        const g = this.scene.grid
        const a = g.show ? { x: snapCenter(start.x, g.size, g.offsetX), y: snapCenter(start.y, g.size, g.offsetY) } : start
        const b = g.show ? { x: snapCenter(w.x, g.size, g.offsetX), y: snapCenter(w.y, g.size, g.offsetY) } : w
        this.overlay.clear().moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 4 / this.world.scale.x, color: '#c9a24a' }).circle(b.x, b.y, 6 / this.world.scale.x).fill('#c9a24a')
        this.label(b.x, b.y - 12 / this.world.scale.x, this.measure(cells(a.x, a.y, b.x, b.y, g)))
      } else if (this.tool === 'draw') {
        pts.push(w.x, w.y)
        this.overlay.clear().moveTo(pts[0]!, pts[1]!)
        for (let i = 2; i < pts.length; i += 2) this.overlay.lineTo(pts[i]!, pts[i + 1]!)
        this.overlay.stroke({ width: 4, color: this.drawColor, cap: 'round', join: 'round' })
      } else if (this.hooks.tool && (this.tool !== 'select' || grabbed) && moved) {
        this.hooks.tool(this.tool, 'drag', start, w, { shift: ev.shiftKey, alt: ev.altKey })
      }
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      if (pingTimer) clearTimeout(pingTimer)
      const w = this.toWorld(ev.clientX, ev.clientY)
      if (this.tool === 'ruler') { this.overlay.clear(); this.overlayText.text = '' }
      if (pan) return
      if (marquee) {
        this.overlay.clear()
        if (moved) this.selectArea(start, w, ev.shiftKey)
        else this.hooks.tool?.('select', 'click', w, undefined, { shift: ev.shiftKey, alt: ev.altKey })
      } else if (this.tool === 'draw') {
        this.overlay.clear()
        if (pts.length >= 4) this.on.draw(simplify(pts, 1.5 / this.world.scale.x))
      } else if (this.tool === 'erase') {
        const hit = [...this.drawings.values()].filter(({ data }) => nearPolyline(data.points, w.x, w.y, Math.max(data.width, 10 / this.world.scale.x))).map(({ data }) => data.id)
        if (hit.length) this.on.erase(hit)
        else this.hooks.tool?.('erase', 'click', w, undefined, { shift: ev.shiftKey, alt: ev.altKey })
      } else if (this.tool === 'pin' && !moved) {
        if (this.scene) this.on.pin(w.x / this.scene.width, w.y / this.scene.height)
      } else if (this.tool === 'align' && !moved) {
        this.alignClick(w.x, w.y)
      } else if (this.hooks.tool && (this.tool !== 'select' || grabbed) && this.tool !== 'ruler') {
        // 'click' no soltar: sem `b` foi um clique; com `b` terminou um arraste de `a` até `b`.
        this.hooks.tool(this.tool, 'click', start, moved ? w : undefined, { shift: ev.shiftKey, alt: ev.altKey })
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  // Todo token que encosta na área marcada entra na seleção.
  private selectArea(a: { x: number; y: number }, b: { x: number; y: number }, add: boolean) {
    const px = this.scene?.grid.size ?? 0
    const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)], [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)]
    const hit = [...this.tokens.values()].map((k) => k.data).filter((t) => t.x < x2 && t.x + t.size * px > x1 && t.y < y2 && t.y + t.size * px > y1).map((t) => t.id)
    const next = [...new Set([...(add ? this.selected : []), ...hit])]
    this.setSelected(next)
    this.on.select(next)
  }

  // T3: alinhar o grid clicando em 2 cantos opostos de um quadrado do mapa.
  private alignFirst: { x: number; y: number } | null = null
  private alignClick(x: number, y: number) {
    if (!this.alignFirst) {
      this.alignFirst = { x, y }
      this.overlay.clear().circle(x, y, 6 / this.world.scale.x).fill('#c9a24a')
      return
    }
    const a = this.alignFirst
    this.alignFirst = null
    this.overlay.clear()
    const size = (Math.abs(x - a.x) + Math.abs(y - a.y)) / 2
    if (size < 8) return
    const ox = Math.min(a.x, x) % size, oy = Math.min(a.y, y) % size
    this.on.align(Math.round(size * 100) / 100, Math.round(ox * 100) / 100, Math.round(oy * 100) / 100)
  }

  setTool(t: Tool) {
    this.tool = t
    this.alignFirst = null
    this.overlay.clear()
    this.overlayText.text = ''
    // Antes do init() terminar o Pixi ainda não tem canvas.
    if (this.app.renderer) this.app.canvas.style.cursor = t === 'select' ? 'default' : t === 'pan' ? 'grab' : 'crosshair'
  }
}

// Constante de tempo do deslize: chega em uns 300 ms. Maior = mais lento.
const GLIDE_MS = 70
// FPS com a mesa parada, e por quanto tempo depois do último movimento ela segue sem limite.
const IDLE_FPS = 30
const HOT_MS = 400
const snapCenter = (v: number, size: number, off: number) => Math.floor((v - off) / size) * size + off + size / 2
const place = (v: number, g: Grid, off: number) => g.show ? snap(v, g.size, off) : v

function nearPolyline(p: number[], x: number, y: number, tol: number) {
  for (let i = 2; i < p.length; i += 2) if (segDist(p[i - 2]!, p[i - 1]!, p[i]!, p[i + 1]!, x, y) <= tol) return true
  return false
}

export function segDist(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
  const dx = bx - ax, dy = by - ay
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// Tira pontos quase colineares do traço, para não mandar milhares de pontos ao servidor.
function simplify(p: number[], tol: number) {
  const out = [p[0]!, p[1]!]
  for (let i = 2; i < p.length - 2; i += 2) {
    const [lx, ly] = [out[out.length - 2]!, out[out.length - 1]!]
    if (Math.hypot(p[i]! - lx, p[i + 1]! - ly) > tol * 3) out.push(Math.round(p[i]!), Math.round(p[i + 1]!))
  }
  out.push(Math.round(p[p.length - 2]!), Math.round(p[p.length - 1]!))
  return out.slice(0, 4000)
}
