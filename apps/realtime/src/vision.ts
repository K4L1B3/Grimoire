// Visão e névoa no servidor (L3–L6): um jogador nunca recebe token que seus tokens não enxergam.
import { and, eq } from 'drizzle-orm'
import { db, fog, type pin, type token } from '@grimorio/db'
import { cellOf, DEFAULT_GRID, fogGrid, moveBlocked, moveSegments, packBits, sightSegments, tokenLights, unpackBits, visibleCells, type Grid, type WallLike } from '@grimorio/core'
import type { SceneState } from './board.ts'
import type { S } from './ctx.ts'

type TokenRow = typeof token.$inferSelect
// bits: o que o jogador já explorou (libera pin sob a névoa). reveal: só o revelado à mão, único que aparece sem token por perto.
export type FogView = { cell: number; cols: number; rows: number; bits: string; reveal: string }
export type Vis = {
  sees: (t: TokenRow) => boolean
  seesPin: (p: typeof pin.$inferSelect) => boolean
  blocked: (t: TokenRow, x: number, y: number) => boolean
  fog: FogView | null
}

// O que muda a névoa de alguém: explorar ou o mestre revelar, mesmo em célula já explorada.
export const fogKey = (f: FogView | null) => (f ? f.bits + f.reveal : undefined)

const center = (t: TokenRow, g: Grid) => ({ x: t.x + (t.size * g.size) / 2, y: t.y + (t.size * g.size) / 2 })

export async function visibility(st: NonNullable<SceneState>, s: S): Promise<Vis> {
  const m = s.data.member
  const sc = st.scene
  const g = { ...DEFAULT_GRID, ...(sc.grid as Partial<Grid>) }
  const walls = st.walls as WallLike[]
  const move = moveSegments(walls)
  // Colisão vale sempre que houver parede (L6), com ou sem modo masmorra.
  const blocked = (t: TokenRow, x: number, y: number) => {
    const a = center(t, g), b = center({ ...t, x, y }, g)
    return moveBlocked(a.x, a.y, b.x, b.y, move)
  }
  if (!sc.dungeon) return { sees: () => true, seesPin: () => true, blocked, fog: null }

  const grid = fogGrid(sc.width, sc.height)
  const size = grid.cols * grid.rows
  const unpack = (b: Buffer | null | undefined) => (b?.length === Math.ceil(size / 8) ? unpackBits(new Uint8Array(b), size) : new Uint8Array(size))
  const revealed = unpack(sc.reveal)
  const reveal = Buffer.from(packBits(revealed)).toString('base64')

  // O mestre vê tudo: o véu dele sai no cliente, pelo que os tokens dos jogadores enxergam agora.
  if (m.role === 'gm') return { sees: () => true, seesPin: () => true, blocked, fog: { ...grid, bits: reveal, reveal } }

  const owners = (t: TokenRow) => (t.actorId ? st.actors.get(t.actorId)?.ownerIds ?? [] : [])
  // Observador vê o que o grupo vê (tokens de todos os jogadores).
  const mine = (t: TokenRow) => (m.role === 'observer' ? owners(t).length > 0 : owners(t).includes(m.userId))
  const viewers = st.tokens.filter((t) => t.layer === 'tokens' && mine(t)).map((t) => ({ ...center(t, g), vision: t.vision as { range: number; dark: number } | null }))
  const carried = tokenLights(st.tokens.map((t) => ({ ...center(t, g), layer: t.layer, light: t.light as { bright: number; dim: number } | null })))
  const now = visibleCells(sc.width, sc.height, sightSegments(walls), viewers, [...st.lights.map((l) => ({ x: l.x, y: l.y, dim: Math.max(l.dim, l.bright) })), ...carried], true)

  // Névoa explorada: o que já foi visto fica registrado (P8), mas o jogador volta a ver breu ali.
  const n = now.cols * now.rows
  const [row] = await db.select({ bits: fog.bits }).from(fog).where(and(eq(fog.sceneId, sc.id), eq(fog.userId, m.userId)))
  const explored = unpack(row?.bits)
  let changed = !row
  for (let i = 0; i < n; i++) if ((now.mask[i] || revealed[i]) && !explored[i]) (explored[i] = 1, (changed = true))
  const packed = packBits(explored)
  if (changed) await db.insert(fog).values({ sceneId: sc.id, userId: m.userId, bits: Buffer.from(packed) }).onConflictDoUpdate({ target: [fog.sceneId, fog.userId], set: { bits: Buffer.from(packed) } })

  return {
    sees: (t) => mine(t) || !!now.mask[cellOf(now, center(t, g).x, center(t, g).y)],
    // P8: pin marcado "sob a névoa" só aparece depois que a área foi vista.
    seesPin: (p) => !p.hiddenByFog || !!explored[cellOf(now, p.x * sc.width, p.y * sc.height)],
    blocked,
    fog: { cell: now.cell, cols: now.cols, rows: now.rows, bits: Buffer.from(packed).toString('base64'), reveal },
  }
}
