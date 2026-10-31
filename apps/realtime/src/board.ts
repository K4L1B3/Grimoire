// Tabuleiro (SDD §6): o servidor é a autoridade; cada mudança é validada e cada pessoa recebe só o que pode ver.
import { z } from 'zod'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db, actor, asset, drawing, light, pin, scene, sheet, sheetTemplate, token, wall, worldMap, page } from '@grimorio/db'
import {
  applyHp, can, DEFAULT_GRID, defaultTorch, FIELD, mergeConditions, nextTurn, pathCells, pinVisible, prevTurn, reorder, roll, shuffle, sortByInit, toggleEffect, tokenVisible, viewCombat,
  type Combat, type Combatant, type Field, type Grid, type Member,
} from '@grimorio/core'
import { handler, refreshMember, refsOfActors, type IO, type S } from './ctx.ts'
import { postInitiative } from './chat.ts'
import { broadcastSound } from './music.ts'
import { onSheetChange } from './sheets.ts'
import { fogKey, visibility } from './vision.ts'

const uuid = z.string().uuid()
const num = z.number().finite()
const sceneRoom = (id: string) => `scene:${id}`

type TokenRow = typeof token.$inferSelect
type ActorRow = { id: string; ownerIds: string[]; avatarAssetId: string | null; name: string }
export type SceneState = Awaited<ReturnType<typeof loadState>>

// Tudo que o filtro precisa para decidir o que cada pessoa vê numa cena.
export async function loadState(sceneId: string) {
  const [sc] = await db.select().from(scene).where(eq(scene.id, sceneId))
  if (!sc) return null
  const tokens = await db.select().from(token).where(eq(token.sceneId, sceneId))
  const actorIds = [...new Set(tokens.map((t) => t.actorId).filter((x): x is string => !!x))]
  const actors = actorIds.length ? await db.select({ id: actor.id, ownerIds: actor.ownerIds, avatarAssetId: actor.avatarAssetId, name: actor.name }).from(actor).where(inArray(actor.id, actorIds)) : []
  const walls = await db.select().from(wall).where(eq(wall.sceneId, sceneId))
  const lights = await db.select().from(light).where(eq(light.sceneId, sceneId))
  const sheets = actorIds.length ? await db.select({ id: sheet.id, actorId: sheet.actorId }).from(sheet).where(and(inArray(sheet.actorId, actorIds), sql`${sheet.alias} is null`)) : []
  return { scene: sc, tokens, actors: new Map(actors.map((a) => [a.id, a])), sheets: new Map(sheets.map((x) => [x.actorId, x.id])), refs: await refsOfActors(actorIds), walls, lights }
}

const ownersOf = (st: { actors: Map<string, ActorRow> }, t: Pick<TokenRow, 'actorId'>) => (t.actorId ? st.actors.get(t.actorId)?.ownerIds ?? [] : [])
const tokenImage = (st: { actors: Map<string, ActorRow> }, t: TokenRow) => t.imageAssetId ?? (t.actorId ? st.actors.get(t.actorId)?.avatarAssetId : null) ?? null

// Barras (T5): ligadas a campos da ficha; números só para o mestre, os donos e personagens de jogadores.
function bars(st: NonNullable<SceneState>, t: TokenRow, m: Member) {
  const refs = t.actorId ? st.refs.get(t.actorId) ?? {} : {}
  const owners = ownersOf(st, t)
  if (m.role !== 'gm' && !owners.includes(m.userId) && owners.length === 0) return []
  const cfg = (t.bars as { value: string; max: string; color: string }[]).length
    ? (t.bars as { value: string; max: string; color: string }[])
    : refs[FIELD.hp] !== undefined && refs[FIELD.hpMax] !== undefined ? [{ value: FIELD.hp, max: FIELD.hpMax, color: '#d9534f' }] : []
  return cfg.slice(0, 2).flatMap((b) => (refs[b.value] !== undefined ? [{ ...b, v: refs[b.value]!, m: refs[b.max] ?? null }] : []))
}

// Números do cartão de hover: a vida segue a regra das barras; CA, defesa e CD são segredo como no combate.
function stats(st: NonNullable<SceneState>, t: TokenRow, m: Member) {
  const refs = t.actorId ? st.refs.get(t.actorId) ?? {} : {}
  const owners = ownersOf(st, t)
  const life = m.role === 'gm' || owners.length > 0
  const mine = can(m, 'token.move', { ownerIds: owners })
  const field = (allowed: boolean, name: string) => (allowed ? refs[name] ?? null : null)
  return { hp: field(life, FIELD.hp), hpMax: field(life, FIELD.hpMax), ac: field(mine, FIELD.ac), defense: field(mine, FIELD.defense), dc: field(mine, FIELD.dc) }
}

export function tokenView(st: NonNullable<SceneState>, t: TokenRow, m: Member) {
  const a = t.actorId ? st.actors.get(t.actorId) : undefined
  const combat = st.scene.combat as Combat | null
  const fromCombat = combat?.combatants.find((c) => c.tokenId === t.id && (!c.hidden || m.role === 'gm'))?.conditions ?? []
  return {
    id: t.id, actorId: t.actorId, name: t.name || a?.name || '', image: tokenImage(st, t),
    x: t.x, y: t.y, size: t.size, layer: t.layer, vision: t.vision, light: t.light,
    conditions: mergeConditions(t.conditions, fromCombat).map((c) => (c.rounds ? `${c.name} (${c.rounds})` : c.name)),
    bars: bars(st, t, m),
    stats: stats(st, t, m),
    mine: can(m, 'token.move', { ownerIds: ownersOf(st, t) }),
    // Personagem de jogador: o véu do mestre (L7) mostra o que esses tokens enxergam.
    pc: ownersOf(st, t).length > 0,
    // Ficha vinculada: só o mestre e os donos recebem o id (quem abre precisa de acesso à ficha).
    sheetId: t.actorId && can(m, 'token.move', { ownerIds: ownersOf(st, t) }) ? st.sheets.get(t.actorId) ?? null : null,
    // Deslocamento da ficha (C8), só para quem move o token.
    speed: can(m, 'token.move', { ownerIds: ownersOf(st, t) }) && t.actorId ? st.refs.get(t.actorId)?.[FIELD.speed] ?? null : null,
  }
}

function combatView(st: NonNullable<SceneState>, m: Member) {
  const c = st.scene.combat as Combat | null
  if (!c) return null
  const byToken = new Map(st.tokens.map((t) => [t.id, t]))
  return viewCombat(c, m,
    (x) => {
      const t = x.tokenId ? byToken.get(x.tokenId) : undefined
      const refs = t?.actorId ? st.refs.get(t.actorId) : undefined
      const ac = x.ac ?? refs?.[FIELD.ac] ?? null, dc = x.dc ?? refs?.[FIELD.dc] ?? null
      return refs?.[FIELD.hp] !== undefined ? { hp: refs[FIELD.hp]!, max: refs[FIELD.hpMax] ?? null, ac, dc } : { hp: x.hp ?? null, max: x.hpMax ?? null, ac, dc }
    },
    (x) => { const t = x.tokenId ? byToken.get(x.tokenId) : undefined; return !!t && ownersOf(st, t).includes(m.userId) },
    (x) => { const t = x.tokenId ? byToken.get(x.tokenId) : undefined; return t ? { image: tokenImage(st, t), pc: ownersOf(st, t).length > 0, conditions: mergeConditions(t.conditions, x.conditions) } : {} })
}

// Reenvia para cada pessoa na cena só a diferença do que ela pode ver (tokens que entraram, mudaram ou saíram da vista).
export async function sync(io: IO, sceneId: string, changed: Set<string> | 'all', opts: { combat?: boolean } = {}) {
  const st = await loadState(sceneId)
  if (!st) return
  const sockets = await io.in(sceneRoom(sceneId)).fetchSockets()
  for (const raw of sockets) {
    const s = raw as unknown as S
    const m = s.data.member
    const vis = await visibility(st, s)
    const seen = s.data.seen ?? new Set<string>()
    const visible = st.tokens.filter((t) => tokenVisible(t, m) && vis.sees(t))
    const upsert = visible.filter((t) => changed === 'all' || changed.has(t.id) || !seen.has(t.id)).map((t) => tokenView(st, t, m))
    const ids = new Set(visible.map((t) => t.id))
    const remove = [...seen].filter((id) => !ids.has(id))
    s.data.seen = ids
    if (upsert.length || remove.length) raw.emit('token:sync', { sceneId, upsert, remove })
    // Névoa só vai quando muda (alguns KB); junto, pins "sob a névoa" que a área recém-vista revelou (P8).
    if (vis.fog && fogKey(vis.fog) !== s.data.fogBits) {
      raw.emit('fog:sync', { sceneId, ...vis.fog })
      for (const p of await db.select().from(pin).where(and(eq(pin.sceneId, sceneId), eq(pin.hiddenByFog, true)))) {
        if (pinVisible(p, m) && vis.seesPin(p)) raw.emit('pin:upsert', pinView(p, m))
      }
    }
    s.data.fogBits = fogKey(vis.fog)
    if (opts.combat) raw.emit('combat:state', { sceneId, combat: combatView(st, m) })
  }
}

async function snapshot(st: NonNullable<SceneState>, s: S) {
  const m = s.data.member
  const sc = st.scene
  const [pins, drawings] = await Promise.all([
    db.select().from(pin).where(eq(pin.sceneId, sc.id)),
    db.select().from(drawing).where(eq(drawing.sceneId, sc.id)),
  ])
  const vis = await visibility(st, s)
  const visible = st.tokens.filter((t) => tokenVisible(t, m) && vis.sees(t))
  s.data.seen = new Set(visible.map((t) => t.id))
  s.data.fogBits = fogKey(vis.fog)
  return {
    scene: { id: sc.id, name: sc.name, image: sc.assetId, width: sc.width, height: sc.height, grid: { ...DEFAULT_GRID, ...(sc.grid as Partial<Grid>) }, active: sc.active, dungeon: sc.dungeon },
    tokens: visible.map((t) => tokenView(st, t, m)),
    pins: pins.filter((p) => pinVisible(p, m) && vis.seesPin(p)).map((p) => pinView(p, m)),
    drawings: drawings.filter((d) => tokenVisible(d, m)),
    walls: st.walls.map((w) => ({ id: w.id, points: w.points, kind: w.kind, state: w.state })),
    lights: st.lights,
    combat: combatView(st, m),
    fog: vis.fog,
  }
}

export const pinView = (p: typeof pin.$inferSelect, m: Member) => (m.role === 'gm' ? p : { ...p, visibleTo: [] })

// Pins: o mesmo componente serve cena (P1–P8) e mapa da wiki (W8).
const PinData = z.object({
  x: num.min(0).max(1), y: num.min(0).max(1),
  icon: z.string().max(60).nullish(), imageAssetId: z.string().nullish(), label: z.string().max(80).nullish(),
  note: z.object({ text: z.string().max(5000), color: z.string().max(20).optional(), size: z.number().min(0.5).max(4).optional(), round: z.boolean().optional() }).nullish(),
  linkPageId: z.string().nullish(),
  visibility: z.enum(['all', 'gm', 'some']), visibleTo: z.array(z.string()).max(50), hiddenByFog: z.boolean(),
})

export function registerBoard(io: IO, s: S) {
  const { campaignId } = s.data
  const gm = async () => {
    const m = await refreshMember(s)
    if (!m || !can(m, 'scene.edit', null)) throw new Error('Só o mestre pode fazer isso')
    return m
  }
  const ownScene = async (sceneId: string) => {
    const [sc] = await db.select().from(scene).where(and(eq(scene.id, sceneId), eq(scene.campaignId, campaignId)))
    if (!sc) throw new Error('Cena não encontrada')
    return sc
  }
  const ownToken = async (id: string) => {
    const [row] = await db.select({ t: token, campaignId: scene.campaignId }).from(token).innerJoin(scene, eq(scene.id, token.sceneId)).where(eq(token.id, id))
    if (!row || row.campaignId !== campaignId) throw new Error('Token não encontrado')
    return row.t
  }
  // Token que a pessoa controla: mestre, ou dono de um token que ele enxerga.
  const ownedToken = async (id: string) => {
    const m = await refreshMember(s)
    const t = await ownToken(id)
    const st = (await loadState(t.sceneId))!
    if (!m || !can(m, 'token.move', { ownerIds: ownersOf(st, t) })) throw new Error('Esse token não é seu')
    if (!tokenVisible(t, m)) throw new Error('Token não encontrado')
    return { m, t, st }
  }
  // Pins de cena ou de mapa da wiki: o pai precisa ser desta campanha.
  const pinRoom = async (p: { sceneId?: string | null; mapId?: string | null }) => {
    if (p.sceneId) return (await ownScene(p.sceneId), sceneRoom(p.sceneId))
    const [mp] = await db.select({ id: worldMap.id }).from(worldMap).innerJoin(page, eq(page.id, worldMap.pageId)).where(and(eq(worldMap.id, p.mapId!), eq(page.campaignId, campaignId)))
    if (!mp) throw new Error('Mapa não encontrado')
    return `map:${mp.id}`
  }
  const emitPins = async (room: string, pinId: string) => {
    const [p] = await db.select().from(pin).where(eq(pin.id, pinId))
    for (const raw of await io.in(room).fetchSockets()) {
      const o = raw as unknown as S
      const fogged = p && p.sceneId && p.hiddenByFog && !(await visibility((await loadState(p.sceneId))!, o)).seesPin(p)
      if (p && pinVisible(p, o.data.member) && !fogged) raw.emit('pin:upsert', pinView(p, o.data.member))
      else raw.emit('pin:remove', { id: pinId })
    }
  }

  s.on('scene:list', handler(z.object({}).passthrough().parse, async () => {
    const m = await refreshMember(s)
    const rows = await db.select({ id: scene.id, name: scene.name, active: scene.active, image: scene.assetId, dungeon: scene.dungeon }).from(scene).where(eq(scene.campaignId, campaignId)).orderBy(asc(scene.sortOrder))
    // Jogador só sabe da cena ativa; o mestre prepara as outras sem ninguém ver (T2).
    return m?.role === 'gm' ? rows : rows.filter((r) => r.active)
  }))

  s.on('scene:join', handler(z.object({ sceneId: z.string().nullish() }).parse, async ({ sceneId }) => {
    const m = await refreshMember(s)
    if (!m) throw new Error('Sem acesso')
    const [target] = sceneId && m.role === 'gm'
      ? await db.select({ id: scene.id }).from(scene).where(and(eq(scene.id, sceneId), eq(scene.campaignId, campaignId)))
      : await db.select({ id: scene.id }).from(scene).where(and(eq(scene.campaignId, campaignId), eq(scene.active, true)))
    for (const r of s.rooms) if (r.startsWith('scene:')) s.leave(r)
    if (!target) return { scene: null }
    s.join(sceneRoom(target.id))
    s.data.sceneId = target.id
    return snapshot((await loadState(target.id))!, s)
  }))

  s.on('scene:activate', handler(z.object({ sceneId: uuid }).parse, async ({ sceneId }) => {
    await gm()
    const sc = await ownScene(sceneId)
    await db.transaction(async (tx) => {
      await tx.update(scene).set({ active: false }).where(and(eq(scene.campaignId, campaignId), eq(scene.active, true)))
      // A música da cena começa do início junto com ela.
      await tx.update(scene).set({ active: true, music: { ...(sc.music as object), startedAt: Date.now() } }).where(eq(scene.id, sceneId))
    })
    // Todos os jogadores são levados à nova cena (T2).
    io.to(`c:${campaignId}`).emit('scene:activated', { sceneId })
    await broadcastSound(io, campaignId)
  }))

  s.on('scene:update', handler(z.object({
    sceneId: uuid,
    patch: z.object({
      name: z.string().trim().min(1).max(80).optional(),
      dungeon: z.boolean().optional(),
      grid: z.object({ show: z.boolean(), size: num.min(8).max(500), offsetX: num, offsetY: num, color: z.string().max(20), unit: num.min(0).max(1000), diagonal: z.enum(['1:1', '5-10-5']) }).partial().optional(),
    }),
  }).parse, async ({ sceneId, patch }) => {
    await gm()
    const sc = await ownScene(sceneId)
    const grid = patch.grid ? { ...DEFAULT_GRID, ...(sc.grid as Partial<Grid>), ...patch.grid } : undefined
    await db.update(scene).set({ ...patch, grid }).where(eq(scene.id, sceneId))
    io.to(sceneRoom(sceneId)).emit('scene:patched', { sceneId, patch: { ...patch, ...(grid ? { grid } : {}) } })
    if (patch.dungeon !== undefined) await sync(io, sceneId, 'all')
  }))

  s.on('scene:delete', handler(z.object({ sceneId: uuid }).parse, async ({ sceneId }) => {
    await gm()
    const sc = await ownScene(sceneId)
    await db.delete(scene).where(eq(scene.id, sceneId))
    io.to(sceneRoom(sceneId)).emit('scene:deleted', { sceneId })
    if (sc.active) {
      io.to(`c:${campaignId}`).emit('scene:activated', { sceneId: null })
      await broadcastSound(io, campaignId)
    }
  }))

  // --- Tokens ---
  // Campos editáveis sem default: no zod 4 `.partial()` mantém defaults, e um patch apagaria o que não mandou.
  const TokenFields = z.object({
    imageAssetId: z.string().nullish(), name: z.string().max(80),
    x: num, y: num, size: z.number().int().min(1).max(20), layer: z.enum(['tokens', 'gm']),
    bars: z.array(z.object({ value: z.string().max(40), max: z.string().max(40), color: z.string().max(20) })).max(2),
    vision: z.object({ range: num.min(0).max(10_000), dark: num.min(0).max(10_000) }).nullish(),
    light: z.object({ bright: num.min(0).max(10_000), dim: num.min(0).max(10_000), color: z.string().max(20) }).nullish(),
  })
  const TokenCreate = TokenFields.partial().required({ x: true, y: true }).extend({ id: uuid.optional(), sceneId: uuid, actorId: z.string().nullish() })

  s.on('token:create', handler(TokenCreate.parse, async (t) => {
    const m = await refreshMember(s)
    const sc = await ownScene(t.sceneId)
    const [a] = t.actorId ? await db.select({ ownerIds: actor.ownerIds }).from(actor).where(and(eq(actor.id, t.actorId), eq(actor.campaignId, campaignId))) : []
    if (t.actorId && !a) throw new Error('Personagem não encontrado')
    // Jogador só coloca o próprio personagem na cena ativa, e nunca na camada do mestre.
    const isGm = m?.role === 'gm'
    if (!isGm && !(m && a && sc.active && can(m, 'token.move', { ownerIds: a.ownerIds }))) throw new Error('Só o mestre pode fazer isso')
    // Luz e visão decidem o que se enxerga no escuro: o jogador recebe o padrão, nunca o que pedir.
    const [row] = await db.insert(token).values(isGm ? t : { sceneId: t.sceneId, actorId: t.actorId, name: t.name, x: t.x, y: t.y, size: t.size, vision: { range: 0, dark: 0 }, light: defaultTorch({ ...DEFAULT_GRID, ...(sc.grid as Partial<Grid>) }) }).returning()
    await sync(io, t.sceneId, new Set([row!.id]))
    return { id: row!.id }
  }))

  s.on('token:move', handler(z.object({ id: uuid, x: num, y: num, path: z.array(num).max(400).optional() }).parse, async ({ id, x, y, path }) => {
    const { m, t, st } = await ownedToken(id)
    const sc = st.scene
    const nx = Math.max(0, Math.min(sc.width - 1, x)), ny = Math.max(0, Math.min(sc.height - 1, y))
    // Colisão (L6): token de jogador não atravessa parede nem porta fechada.
    const vis = await visibility(st, s)
    if (m.role !== 'gm' && vis.blocked(t, nx, ny)) throw new Error('Tem uma parede no caminho')
    await db.update(token).set({ x: nx, y: ny }).where(eq(token.id, id))
    // Deslocamento do turno (C8): soma o caminho andado pelo combatente da vez.
    const combat = sc.combat as Combat | null
    const cur = combat?.combatants[combat.turn]
    if (combat && cur?.tokenId === id && path) {
      const g = { ...DEFAULT_GRID, ...(sc.grid as Partial<Grid>) }
      cur.moved += pathCells(path, g)
      await db.update(scene).set({ combat }).where(eq(scene.id, sc.id))
      await sync(io, t.sceneId, new Set([id]), { combat: true })
    } else await sync(io, t.sceneId, new Set([id]))
  }))

  s.on('token:update', handler(z.object({ id: uuid, patch: TokenFields.partial().extend({ actorId: z.string().nullish() }) }).parse, async ({ id, patch }) => {
    const { m, t } = await ownedToken(id)
    // O dono configura o token; andar sem passar pela colisão, esconder, trocar de ficha, luz e visão continuam com o mestre.
    if (m.role !== 'gm' && Object.keys(patch).some((k) => ['x', 'y', 'layer', 'actorId', 'light', 'vision'].includes(k))) throw new Error('Só o mestre pode fazer isso')
    if (patch.imageAssetId) {
      const [a] = await db.select({ id: asset.id }).from(asset).where(and(eq(asset.id, patch.imageAssetId), eq(asset.campaignId, campaignId)))
      if (!a) throw new Error('Imagem não encontrada')
    }
    if (patch.actorId) {
      const [a] = await db.select({ id: actor.id }).from(actor).where(and(eq(actor.id, patch.actorId), eq(actor.campaignId, campaignId)))
      if (!a) throw new Error('Personagem não encontrado')
    }
    await db.update(token).set(patch).where(eq(token.id, id))
    await sync(io, t.sceneId, new Set([id]))
  }))

  // Efeitos: como mover, vale para o mestre e para o dono do token.
  s.on('token:effect', handler(z.object({ id: uuid, name: z.string().trim().min(1).max(40) }).parse, async ({ id, name }) => {
    const { t, st } = await ownedToken(id)
    const before = st.scene.combat as Combat | null
    const { conditions, combat } = toggleEffect(name, t.conditions, before, id)
    if (conditions.length > 20) throw new Error('Limite de 20 efeitos por token')
    await db.update(token).set({ conditions }).where(eq(token.id, id))
    if (combat !== before) await db.update(scene).set({ combat }).where(eq(scene.id, t.sceneId))
    await sync(io, t.sceneId, new Set([id]), { combat: !!before })
  }))

  s.on('token:delete', handler(z.object({ ids: z.array(uuid).min(1).max(200) }).parse, async ({ ids }) => {
    const m = await refreshMember(s)
    const rows = await Promise.all(ids.map(async (id) => (m?.role === 'gm' ? ownToken(id) : (await ownedToken(id)).t)))
    await db.delete(token).where(inArray(token.id, ids))
    for (const sceneId of new Set(rows.map((r) => r.sceneId))) await sync(io, sceneId, new Set())
  }))

  // --- Pins ---
  s.on('pin:create', handler(PinData.partial().extend({ id: uuid.optional(), sceneId: uuid.nullish(), mapId: uuid.nullish(), x: num.min(0).max(1), y: num.min(0).max(1) }).parse, async (p) => {
    await gm()
    if (!p.sceneId === !p.mapId) throw new Error('Pin precisa de uma cena ou um mapa')
    const room = await pinRoom(p)
    const [row] = await db.insert(pin).values({ ...p, note: p.note ?? null }).returning()
    await emitPins(room, row!.id)
    return { id: row!.id }
  }))

  s.on('pin:update', handler(z.object({ id: uuid, patch: PinData.partial() }).parse, async ({ id, patch }) => {
    await gm()
    const [p] = await db.select().from(pin).where(eq(pin.id, id))
    if (!p) throw new Error('Pin não encontrado')
    const room = await pinRoom(p)
    await db.update(pin).set(patch).where(eq(pin.id, id))
    await emitPins(room, id)
  }))

  s.on('pin:delete', handler(z.object({ id: uuid }).parse, async ({ id }) => {
    await gm()
    const [p] = await db.select().from(pin).where(eq(pin.id, id))
    if (!p) return
    const room = await pinRoom(p)
    await db.delete(pin).where(eq(pin.id, id))
    io.to(room).emit('pin:remove', { id })
  }))

  // --- Desenho livre (T9) e ping (T8) ---
  s.on('drawing:create', handler(z.object({ id: uuid.optional(), sceneId: uuid, points: z.array(num).min(4).max(4000), color: z.string().max(20), width: num.min(1).max(100), layer: z.enum(['tokens', 'gm']).default('tokens') }).parse, async (d) => {
    const m = await refreshMember(s)
    if (!m || m.role === 'observer' || (d.layer === 'gm' && m.role !== 'gm')) throw new Error('Sem permissão para desenhar')
    await ownScene(d.sceneId)
    const [row] = await db.insert(drawing).values(d).returning()
    for (const raw of await io.in(sceneRoom(d.sceneId)).fetchSockets()) if (tokenVisible(row!, (raw as unknown as S).data.member)) raw.emit('drawing:upsert', row)
    return { id: row!.id }
  }))

  s.on('drawing:delete', handler(z.object({ ids: z.array(uuid).min(1).max(500) }).parse, async ({ ids }) => {
    const m = await refreshMember(s)
    if (!m || m.role === 'observer') throw new Error('Sem permissão')
    const rows = await db.select({ d: drawing, campaignId: scene.campaignId }).from(drawing).innerJoin(scene, eq(scene.id, drawing.sceneId)).where(inArray(drawing.id, ids))
    const mine = rows.filter((r) => r.campaignId === campaignId && (m.role === 'gm' || r.d.layer === 'tokens')).map((r) => r.d)
    if (!mine.length) return
    await db.delete(drawing).where(inArray(drawing.id, mine.map((d) => d.id)))
    for (const sceneId of new Set(mine.map((d) => d.sceneId))) io.to(sceneRoom(sceneId)).emit('drawing:remove', { ids: mine.map((d) => d.id) })
  }))

  s.on('ping', handler(z.object({ x: num, y: num }).parse, async ({ x, y }) => {
    if (!s.data.sceneId || s.data.member.role === 'observer') return
    io.to(sceneRoom(s.data.sceneId)).emit('ping', { x, y, by: s.data.userName, userId: s.data.member.userId })
  }))

  // --- Combate (C1–C8) ---
  const withCombat = async (sceneId: string, fn: (c: Combat | null, st: NonNullable<SceneState>) => Promise<Combat | null> | Combat | null) => {
    await gm()
    await ownScene(sceneId)
    const st = (await loadState(sceneId))!
    const next = await fn(st.scene.combat as Combat | null, st)
    await db.update(scene).set({ combat: next }).where(eq(scene.id, sceneId))
    await sync(io, sceneId, new Set(st.tokens.map((t) => t.id)), { combat: true })
  }
  const fromToken = (st: NonNullable<SceneState>, t: TokenRow): Combatant => ({
    id: crypto.randomUUID(), tokenId: t.id, name: t.name || (t.actorId ? st.actors.get(t.actorId)?.name : '') || 'Sem nome',
    init: null, hpMode: ownersOf(st, t).length ? 'exact' : 'status', hidden: t.layer === 'gm', conditions: [], moved: 0,
  })
  const tokensOf = (st: NonNullable<SceneState>, ids: string[]) => st.tokens.filter((t) => ids.includes(t.id))

  // Estado do combate para a janela de combate (filtrado como no sync).
  s.on('combat:get', handler(z.object({ sceneId: uuid }).parse, async ({ sceneId }) => {
    const m = await refreshMember(s)
    await ownScene(sceneId)
    const st = (await loadState(sceneId))!
    if (!m || (!st.scene.active && m.role !== 'gm')) throw new Error('Cena não encontrada')
    return combatView(st, m)
  }))

  // Tokens do mapa que ainda podem entrar no combate.
  s.on('combat:candidates', handler(z.object({ sceneId: uuid }).parse, async ({ sceneId }) => {
    await gm()
    await ownScene(sceneId)
    const st = (await loadState(sceneId))!
    const inCombat = new Set((st.scene.combat as Combat | null)?.combatants.map((c) => c.tokenId))
    return st.tokens.filter((t) => !inCombat.has(t.id)).map((t) => ({ id: t.id, name: t.name || (t.actorId ? st.actors.get(t.actorId)?.name : '') || 'Sem nome', image: tokenImage(st, t), pc: ownersOf(st, t).length > 0 }))
  }))

  s.on('combat:start', handler(z.object({ sceneId: uuid, tokenIds: z.array(uuid).max(100) }).parse, ({ sceneId, tokenIds }) =>
    withCombat(sceneId, (c, st) => ({ ...(c ?? { round: 1, turn: 0, combatants: [] }), combatants: [...(c?.combatants ?? []), ...tokensOf(st, tokenIds).filter((t) => !c?.combatants.some((x) => x.tokenId === t.id)).map((t) => fromToken(st, t))] }))))

  s.on('combat:addNpc', handler(z.object({ sceneId: uuid, name: z.string().trim().min(1).max(80), hp: z.number().int().nullish(), ac: z.number().nullish(), init: z.number().nullish() }).parse, ({ sceneId, name, hp, ac, init }) =>
    withCombat(sceneId, (c) => ({ ...(c ?? { round: 1, turn: 0, combatants: [] }), combatants: [...(c?.combatants ?? []), { id: crypto.randomUUID(), name, hp: hp ?? null, hpMax: hp ?? null, ac: ac ?? null, init: init ?? null, hpMode: 'status', hidden: false, conditions: [], moved: 0 }] }))))

  s.on('combat:remove', handler(z.object({ sceneId: uuid, id: z.string() }).parse, ({ sceneId, id }) =>
    withCombat(sceneId, (c) => {
      if (!c) return null
      const i = c.combatants.findIndex((x) => x.id === id)
      const combatants = c.combatants.filter((x) => x.id !== id)
      return combatants.length ? { ...c, combatants, turn: Math.min(i < c.turn ? c.turn - 1 : c.turn, combatants.length - 1) } : null
    })))

  // C2: rola a iniciativa com a ficha (campo "iniciativa" com rolagem, ou 1d20 + @mod_destreza); quem já tem fica, a não ser em `all`.
  // Empate não tem regra de sistema: quem já estava segue na frente e os recém-rolados são sorteados entre si; o mestre ajusta arrastando.
  s.on('combat:rollInit', handler(z.object({ sceneId: uuid, all: z.boolean().default(false) }).parse, ({ sceneId, all }) =>
    withCombat(sceneId, async (c, st) => {
      if (!c) return null
      const templates = await initFormulas(st)
      const rolled = shuffle(c.combatants.filter((x) => all || x.init == null)).map((x) => {
        const t = st.tokens.find((k) => k.id === x.tokenId)
        const refs = t?.actorId ? st.refs.get(t.actorId) ?? {} : {}
        const formula = (t?.actorId && templates.get(t.actorId)) || (FIELD.dex in refs ? `1d20 + @${FIELD.dex}` : FIELD.init in refs ? `1d20 + @${FIELD.init}` : '1d20')
        const r = roll(formula, refs)
        return { x: { ...x, init: r.total }, r }
      })
      for (const { x, r } of rolled) await postInitiative(io, s, r, x.name, x.hidden)
      return reorder(c, sortByInit([...c.combatants.filter((x) => !all && x.init != null), ...rolled.map((k) => k.x)]))
    })))

  s.on('combat:patch', handler(z.object({
    sceneId: uuid, id: z.string(),
    patch: z.object({ init: z.number().nullable(), ac: z.number().nullable(), dc: z.number().nullable(), hpMode: z.enum(['exact', 'status', 'none']), hidden: z.boolean(), name: z.string().max(80), conditions: z.array(z.object({ name: z.string().trim().min(1).max(40), rounds: z.number().int().min(1).max(999).nullish() })).max(20) }).partial(),
  }).parse, ({ sceneId, id, patch }) => withCombat(sceneId, async (c, st) => {
    if (!c) return null
    // Efeito sem duração mora no token e sobrevive ao combate; com duração, fica no combatente, que o vence sozinho (C5).
    const tk = patch.conditions && st.tokens.find((t) => t.id === c.combatants.find((x) => x.id === id)?.tokenId)
    if (tk) await db.update(token).set({ conditions: patch.conditions!.filter((k) => !k.rounds).map((k) => k.name) }).where(eq(token.id, tk.id))
    const combatants = c.combatants.map((x) => (x.id === id ? { ...x, ...patch, ...(tk && { conditions: patch.conditions!.filter((k) => k.rounds) }) } : x))
    // Iniciativa digitada reordena como a rolada.
    return patch.init === undefined ? { ...c, combatants } : reorder(c, sortByInit(combatants))
  })))

  s.on('combat:order', handler(z.object({ sceneId: uuid, ids: z.array(z.string()).max(200) }).parse, ({ sceneId, ids }) =>
    withCombat(sceneId, (c) => c && reorder(c, [...c.combatants].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))))))

  s.on('combat:next', handler(z.object({ sceneId: uuid }).parse, ({ sceneId }) => withCombat(sceneId, (c) => c && nextTurn(c))))
  s.on('combat:prev', handler(z.object({ sceneId: uuid }).parse, ({ sceneId }) => withCombat(sceneId, (c) => c && prevTurn(c))))
  s.on('combat:end', handler(z.object({ sceneId: uuid }).parse, ({ sceneId }) => withCombat(sceneId, () => null)))

  // C4: "-7" ou "+5" grava direto no campo pv_atual da ficha; NPC sem ficha guarda no próprio combatente.
  s.on('combat:hp', handler(z.object({ sceneId: uuid, id: z.string(), input: z.string().max(20) }).parse, ({ sceneId, id, input }) =>
    withCombat(sceneId, async (c, st) => {
      if (!c) return null
      const x = c.combatants.find((k) => k.id === id)
      if (!x) throw new Error('Combatente não encontrado')
      const t = st.tokens.find((k) => k.id === x.tokenId)
      const refs = t?.actorId ? st.refs.get(t.actorId) : undefined
      if (t?.actorId && refs?.[FIELD.hp] !== undefined) {
        const [main] = await db.select({ id: sheet.id }).from(sheet).where(and(eq(sheet.actorId, t.actorId), sql`${sheet.alias} is null`))
        if (main) {
          const v = applyHp(refs[FIELD.hp]!, input, refs[FIELD.hpMax])
          await db.update(sheet).set({ values: sql`${sheet.values} || jsonb_build_object(${FIELD.hp}::text, ${v}::int)` }).where(eq(sheet.id, main.id))
          io.to(`sheet:${main.id}`).emit('sheet:changed', { sheetId: main.id, name: FIELD.hp, value: v })
          return c
        }
      }
      return { ...c, combatants: c.combatants.map((k) => {
        if (k.id !== id) return k
        const hp = applyHp(k.hp ?? 0, input, k.hpMax)
        // Token sem ficha: o primeiro número digitado vira também o máximo, senão a barra não tem referência.
        return { ...k, hp, hpMax: k.hpMax ?? (k.hp == null ? hp : null) }
      }) }
    })))
}

// Fórmula de iniciativa da ficha: o campo "iniciativa" com botão de rolagem (F6), se existir.
async function initFormulas(st: NonNullable<SceneState>) {
  const ids = [...st.actors.keys()]
  const out = new Map<string, string>()
  if (!ids.length) return out
  const rows = await db.select({ actorId: sheet.actorId, fields: sheetTemplate.fields }).from(sheet).innerJoin(sheetTemplate, eq(sheetTemplate.id, sheet.templateId)).where(and(inArray(sheet.actorId, ids), sql`${sheet.alias} is null`))
  for (const r of rows) {
    const f = (r.fields as Field[]).find((x) => x.name === FIELD.init && x.roll)
    if (f && r.actorId) out.set(r.actorId, f.roll!)
  }
  return out
}

// Ficha mudou (vida, campos das barras): atualiza tokens e combate das cenas onde o ator está.
onSheetChange(async (io, _campaignId, actorId) => {
  const rows = await db.selectDistinct({ sceneId: token.sceneId }).from(token).where(eq(token.actorId, actorId))
  for (const { sceneId } of rows) {
    const ids = (await db.select({ id: token.id }).from(token).where(and(eq(token.sceneId, sceneId), eq(token.actorId, actorId)))).map((r) => r.id)
    await sync(io, sceneId, new Set(ids), { combat: true })
  }
})

