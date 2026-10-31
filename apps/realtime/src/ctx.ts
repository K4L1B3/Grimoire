// Contexto compartilhado do realtime: quem está conectado, em qual campanha e com qual papel.
import type { Server, Socket } from 'socket.io'
import { and, eq, inArray } from 'drizzle-orm'
import { db, actor, membership, sheet, sheetTemplate } from '@grimorio/db'
import { actorRefs, type Member } from '@grimorio/core'

// sceneId/seen: cena aberta e tokens que a pessoa já recebeu, para mandar só a diferença.
export type Data = { member: Member; userName: string; campaignId: string; sceneId?: string; seen?: Set<string>; fogBits?: string }
export type S = Socket<any, any, any, Data>
export type IO = Server<any, any, any, Data>

export const room = (campaignId: string) => `c:${campaignId}`

// Emite para cada membro conectado da campanha o que ele pode ver; view devolve undefined para não enviar.
export async function emitFiltered<T>(io: IO, campaignId: string, event: string, view: (s: S) => T | undefined) {
  for (const s of await io.in(room(campaignId)).fetchSockets()) {
    const v = view(s as unknown as S)
    if (v !== undefined) s.emit(event, v)
  }
}

// Recarrega o papel do banco (o mestre pode ter mudado o papel com a pessoa conectada).
export async function refreshMember(s: S) {
  const [m] = await db.select({ role: membership.role }).from(membership).where(and(eq(membership.campaignId, s.data.campaignId), eq(membership.userId, s.data.member.userId)))
  if (!m) return s.disconnect(true), null
  s.data.member = { userId: s.data.member.userId, role: m.role }
  return s.data.member
}

// Ator que o membro pode controlar (mestre: todos da campanha).
export async function ownedActor(s: S, actorId: string) {
  const [a] = await db.select().from(actor).where(and(eq(actor.id, actorId), eq(actor.campaignId, s.data.campaignId)))
  if (!a || (s.data.member.role !== 'gm' && !a.ownerIds.includes(s.data.member.userId))) return null
  return a
}

type SheetRow = { alias: string | null; values: unknown; fields: unknown }
const toActorSheets = (rows: SheetRow[]) =>
  rows.map((r) => ({ alias: r.alias, values: r.values as Record<string, unknown>, fields: r.fields as { name: string; formula?: string }[] }))

export async function refsOfActors(actorIds: string[]) {
  const out = new Map<string, Record<string, number>>()
  if (!actorIds.length) return out
  const rows = await db.select({ actorId: sheet.actorId, alias: sheet.alias, values: sheet.values, fields: sheetTemplate.fields }).from(sheet).innerJoin(sheetTemplate, eq(sheetTemplate.id, sheet.templateId)).where(inArray(sheet.actorId, actorIds))
  for (const id of actorIds) out.set(id, actorRefs(toActorSheets(rows.filter((r) => r.actorId === id))))
  return out
}

export const refsOfActor = async (actorId: string) => (await refsOfActors([actorId])).get(actorId)!

// Limite simples por usuário: no máximo `max` eventos a cada `ms` (SDD §8, rate limit na rolagem).
export function limiter(max: number, ms: number) {
  const hits = new Map<string, number[]>()
  return (key: string) => {
    const now = Date.now()
    const recent = (hits.get(key) ?? []).filter((t) => now - t < ms)
    if (recent.length >= max) return false
    recent.push(now)
    hits.set(key, recent)
    return true
  }
}

export type Ack<T = unknown> = (res: { ok: true; data?: T } | { ok: false; error: string }) => void

// Envolve um handler: valida, captura erro e responde pelo ack sem derrubar o socket.
export function handler<P>(parse: (raw: unknown) => P, fn: (payload: P) => Promise<unknown>) {
  return async (raw: unknown, ack?: Ack) => {
    try {
      const data = await fn(parse(raw))
      if (typeof ack === 'function') ack({ ok: true, data })
    } catch (e) {
      // Erros de regra (Error simples, dado, fórmula) vão para a pessoa; erro de banco ou bug só para o log.
      const userFacing = e instanceof Error && !('issues' in e) && !('code' in e) && !('cause' in e && e.cause)
      if (!userFacing && !(e instanceof Error && 'issues' in e)) console.error(e)
      if (typeof ack === 'function') ack({ ok: false, error: userFacing ? (e as Error).message : 'issues' in (e as object) ? 'Dados inválidos' : 'Algo deu errado no servidor' })
    }
  }
}
