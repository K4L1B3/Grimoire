// Paredes, portas, luzes e névoa (L1–L5). Toda mudança recalcula o que cada jogador enxerga.
import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { db, fog, light, scene, wall } from '@grimorio/db'
import { can, fogGrid, packBits, unpackBits } from '@grimorio/core'
import { handler, refreshMember, type IO, type S } from './ctx.ts'
import { sync } from './board.ts'

const uuid = z.string().uuid()
const num = z.number().finite()
const WallBase = z.object({ points: z.array(num).length(4), kind: z.enum(['wall', 'door', 'window']), state: z.enum(['open', 'closed', 'locked']).nullish() })
const WallIn = WallBase.extend({ id: uuid.optional(), kind: WallBase.shape.kind.default('wall') })

export function registerLighting(io: IO, s: S) {
  const { campaignId } = s.data
  const gmScene = async (sceneId: string) => {
    const m = await refreshMember(s)
    if (!m || !can(m, 'scene.edit', null)) throw new Error('Só o mestre pode fazer isso')
    const [sc] = await db.select().from(scene).where(and(eq(scene.id, sceneId), eq(scene.campaignId, campaignId)))
    if (!sc) throw new Error('Cena não encontrada')
    return sc
  }
  const wallsOf = async (ids: string[]) => {
    const rows = await db.select({ w: wall, campaignId: scene.campaignId }).from(wall).innerJoin(scene, eq(scene.id, wall.sceneId)).where(inArray(wall.id, ids))
    if (rows.some((r) => r.campaignId !== campaignId) || rows.length !== ids.length) throw new Error('Parede não encontrada')
    return rows.map((r) => r.w)
  }
  const broadcast = async (sceneId: string) => {
    const [walls, lights] = await Promise.all([db.select().from(wall).where(eq(wall.sceneId, sceneId)), db.select().from(light).where(eq(light.sceneId, sceneId))])
    io.to(`scene:${sceneId}`).emit('scene:lighting', { sceneId, walls: walls.map(({ sceneId: _, ...w }) => w), lights })
    await sync(io, sceneId, new Set())
  }

  s.on('wall:create', handler(z.object({ sceneId: uuid, walls: z.array(WallIn).min(1).max(500) }).parse, async ({ sceneId, walls }) => {
    await gmScene(sceneId)
    const rows = await db.insert(wall).values(walls.map((w) => ({ ...w, sceneId, state: w.kind === 'door' ? w.state ?? 'closed' : null }))).returning({ id: wall.id })
    await broadcast(sceneId)
    return { ids: rows.map((r) => r.id) }
  }))

  s.on('wall:update', handler(z.object({ id: uuid, patch: WallBase.partial() }).parse, async ({ id, patch }) => {
    const [w] = await wallsOf([id])
    await gmScene(w!.sceneId)
    const kind = patch.kind ?? w!.kind
    await db.update(wall).set({ ...patch, state: kind === 'door' ? patch.state ?? w!.state ?? 'closed' : null }).where(eq(wall.id, id))
    await broadcast(w!.sceneId)
  }))

  s.on('wall:delete', handler(z.object({ ids: z.array(uuid).min(1).max(500) }).parse, async ({ ids }) => {
    const ws = await wallsOf(ids)
    await gmScene(ws[0]!.sceneId)
    await db.delete(wall).where(inArray(wall.id, ids))
    await broadcast(ws[0]!.sceneId)
  }))

  // L2: jogador abre e fecha porta destrancada; só o mestre tranca e destranca.
  s.on('door:toggle', handler(z.object({ id: uuid, lock: z.boolean().optional() }).parse, async ({ id, lock }) => {
    const m = await refreshMember(s)
    const [w] = await wallsOf([id])
    if (!m || m.role === 'observer' || w!.kind !== 'door') throw new Error('Isso não é uma porta')
    const isGm = m.role === 'gm'
    if (w!.state === 'locked' && !isGm) throw new Error('A porta está trancada')
    const state = lock !== undefined && isGm ? (lock ? 'locked' : 'closed') : w!.state === 'open' ? 'closed' : 'open'
    await db.update(wall).set({ state }).where(eq(wall.id, id))
    await broadcast(w!.sceneId)
  }))

  const LightIn = z.object({ x: num, y: num, bright: num.min(0).max(20_000), dim: num.min(0).max(20_000), color: z.string().max(20).nullish() })
  s.on('light:create', handler(LightIn.extend({ id: uuid.optional(), sceneId: uuid }).parse, async (l) => {
    await gmScene(l.sceneId)
    const [row] = await db.insert(light).values(l).returning({ id: light.id })
    await broadcast(l.sceneId)
    return { id: row!.id }
  }))
  s.on('light:update', handler(z.object({ id: uuid, patch: LightIn.partial() }).parse, async ({ id, patch }) => {
    const [l] = await db.select().from(light).where(eq(light.id, id))
    if (!l) throw new Error('Luz não encontrada')
    await gmScene(l.sceneId)
    await db.update(light).set(patch).where(eq(light.id, id))
    await broadcast(l.sceneId)
  }))
  s.on('light:delete', handler(z.object({ id: uuid }).parse, async ({ id }) => {
    const [l] = await db.select().from(light).where(eq(light.id, id))
    if (!l) return
    await gmScene(l.sceneId)
    await db.delete(light).where(eq(light.id, id))
    await broadcast(l.sceneId)
  }))

  // L5: o mestre revela uma área à mão (para todos os jogadores) ou reseta a névoa.
  s.on('fog:reveal', handler(z.object({ sceneId: uuid, rect: z.tuple([num, num, num, num]) }).parse, async ({ sceneId, rect: [x, y, w, h] }) => {
    const sc = await gmScene(sceneId)
    const g = fogGrid(sc.width, sc.height)
    const n = g.cols * g.rows
    const bits = sc.reveal?.length === Math.ceil(n / 8) ? unpackBits(new Uint8Array(sc.reveal), n) : new Uint8Array(n)
    for (let r = Math.max(0, Math.floor(y / g.cell)); r < Math.min(g.rows, Math.ceil((y + h) / g.cell)); r++)
      for (let c = Math.max(0, Math.floor(x / g.cell)); c < Math.min(g.cols, Math.ceil((x + w) / g.cell)); c++) bits[r * g.cols + c] = 1
    await db.update(scene).set({ reveal: Buffer.from(packBits(bits)) }).where(eq(scene.id, sceneId))
    await sync(io, sceneId, new Set())
  }))

  s.on('fog:reset', handler(z.object({ sceneId: uuid }).parse, async ({ sceneId }) => {
    await gmScene(sceneId)
    await db.delete(fog).where(eq(fog.sceneId, sceneId))
    await db.update(scene).set({ reveal: null }).where(eq(scene.id, sceneId))
    await sync(io, sceneId, new Set())
  }))
}
