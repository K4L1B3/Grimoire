// Mesa de som: o mestre mexe na mixagem da cena; todos ouvem a da cena ativa, e os efeitos tocam uma vez para todos.
import { z } from 'zod'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { db, asset, scene } from '@grimorio/db'
import { DEFAULT_MIX, EFFECT_GROUPS, MOODS, mixLayers, type SoundMix, type SoundState } from '@grimorio/core'
import { handler, limiter, refreshMember, room, type IO, type S } from './ctx.ts'

const uuid = z.string().uuid()
const fxLimit = limiter(12, 1000)

const mixOf = (music: unknown): SoundMix => ({ ...DEFAULT_MIX, ...(music as Partial<SoundMix>) })
// Sons que esta campanha pode tocar: os dela e os padrões (asset sem campanha).
const usable = (campaignId: string) => or(eq(asset.campaignId, campaignId), isNull(asset.campaignId))

async function soundState(campaignId: string): Promise<SoundState> {
  const [sc] = await db.select({ music: scene.music }).from(scene).where(and(eq(scene.campaignId, campaignId), eq(scene.active, true)))
  if (!sc) return { layers: [] }
  const mix = mixOf(sc.music)
  // Estado sem música escolhida toca as padrão: campanha nova já sai com som.
  if (mix.mood && !mix.tracks[mix.mood].length) mix.tracks = { ...mix.tracks, [mix.mood]: (await db.select({ id: asset.id }).from(asset).where(and(isNull(asset.campaignId), eq(asset.audioGroup, mix.mood)))).map((r) => r.id) }
  const ids = [...Object.keys(mix.levels), ...(mix.mood ? mix.tracks[mix.mood] : [])]
  const rows = ids.length ? await db.select({ id: asset.id, duration: asset.duration }).from(asset).where(and(inArray(asset.id, ids), usable(campaignId), eq(asset.kind, 'audio'))) : []
  return { layers: mixLayers(mix, new Map(rows.map((r) => [r.id, { id: r.id, duration: r.duration ?? 0 }])), Date.now()) }
}

export const broadcastSound = async (io: IO, campaignId: string) => void io.to(room(campaignId)).emit('music:state', await soundState(campaignId))

export function registerMusic(io: IO, s: S) {
  const { campaignId } = s.data
  const gm = async () => {
    if ((await refreshMember(s))?.role !== 'gm') throw new Error('Só o mestre mexe no som')
  }
  const ownScene = async (sceneId: string) => {
    const [sc] = await db.select({ active: scene.active, music: scene.music }).from(scene).where(and(eq(scene.id, sceneId), eq(scene.campaignId, campaignId)))
    if (!sc) throw new Error('Cena não encontrada')
    return { active: sc.active, mix: mixOf(sc.music) }
  }
  const sendView = async (sceneId: string) => s.emit('music:view', { sceneId, mix: (await ownScene(sceneId)).mix })
  // Cliques rápidos em ambientes diferentes não podem ler a mesma mixagem e um apagar o outro.
  let queue: Promise<unknown> = Promise.resolve()
  const inOrder = <T>(fn: () => Promise<T>) => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }

  s.on('music:get', handler(z.object({}).parse, () => soundState(campaignId)))

  s.on('music:scene', handler(z.object({ sceneId: uuid }).parse, async ({ sceneId }) => {
    await gm()
    await sendView(sceneId)
  }))

  s.on('music:update', handler(z.object({
    sceneId: uuid,
    mood: z.enum(MOODS).nullable().optional(),
    intensity: z.number().int().min(0).max(3).optional(),
    paused: z.boolean().optional(),
    level: z.object({ id: uuid, level: z.number().int().min(0).max(3) }).optional(),
    track: z.object({ id: uuid, mood: z.enum(MOODS), on: z.boolean() }).optional(),
  }).parse, ({ sceneId, mood, intensity, paused, level, track }) => inOrder(async () => {
    await gm()
    const { active, mix } = await ownScene(sceneId)
    const next = { ...mix, levels: { ...mix.levels }, tracks: { ...mix.tracks }, intensity: intensity ?? mix.intensity, paused: paused ?? (mood !== undefined || level ? false : mix.paused) }
    if (mood !== undefined && mood !== mix.mood) Object.assign(next, { mood, startedAt: Date.now() })
    if (level) {
      if (level.level) next.levels[level.id] = level.level
      else delete next.levels[level.id]
    }
    if (track) next.tracks[track.mood] = [...mix.tracks[track.mood].filter((id) => id !== track.id), ...(track.on ? [track.id] : [])]
    await db.update(scene).set({ music: next }).where(eq(scene.id, sceneId))
    await sendView(sceneId)
    if (active) await broadcastSound(io, campaignId)
  })))

  s.on('music:fx', handler(z.object({ id: uuid, gain: z.number().min(0).max(1) }).parse, async ({ id, gain }) => {
    await gm()
    if (!fxLimit(s.data.member.userId)) throw new Error('Calma, são muitos efeitos de uma vez')
    const [a] = await db.select({ group: asset.audioGroup }).from(asset).where(and(eq(asset.id, id), usable(campaignId), inArray(asset.audioGroup, [...EFFECT_GROUPS])))
    if (!a) throw new Error('Efeito não encontrado')
    io.to(room(campaignId)).emit('music:fx', { id, gain })
  }))

  // Depois de apagar um som da biblioteca, que é feito fora daqui.
  s.on('music:sync', handler(z.object({}).parse, async () => {
    await gm()
    await broadcastSound(io, campaignId)
  }))
}
