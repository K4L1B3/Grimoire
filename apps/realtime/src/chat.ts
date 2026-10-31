// Chat e dados (SDD §7): toda rolagem acontece aqui, com gerador criptográfico, antes de qualquer animação.
import { z } from 'zod'
import { and, desc, eq, lt } from 'drizzle-orm'
import { db, actor, chatMessage, membership, user } from '@grimorio/db'
import { can, parseCommand, roll, viewMessage, type Message, type RollResult } from '@grimorio/core'
import { emitFiltered, handler, limiter, ownedActor, refreshMember, refsOfActor, type IO, type S } from './ctx.ts'

const PAGE = 50
const rollLimit = limiter(10, 10_000)
const msgLimit = limiter(20, 10_000)

const Send = z.object({ text: z.string().trim().min(1).max(2000), actorId: z.string().nullish(), visibility: z.enum(['public', 'hidden', 'private']).default('public') })
const History = z.object({ before: z.string().nullish() })

type Row = typeof chatMessage.$inferSelect & { authorName: string; authorImage: string | null; actorName: string | null }
const toMessage = (r: Row): Message => {
  const { label, ...rolled } = (r.roll ?? {}) as RollResult & { label?: string }
  return {
    id: r.id, authorId: r.authorId, authorName: r.authorName, authorImage: r.authorImage, actorName: r.actorName, text: r.text,
    roll: r.roll ? rolled : null, label: label ?? null,
    visibility: r.visibility, toUserIds: r.toUserIds, createdAt: r.createdAt.toISOString(),
  }
}

// Rola e publica no chat; usado pela barra de dados e pela ficha (F6).
export async function postRoll(io: IO, s: S, p: { formula: string; label?: string; actorId?: string | null; visibility: 'public' | 'hidden' | 'private'; refs?: Record<string, number> }) {
  const member = s.data.member
  if (!can(member, 'roll', { visibility: p.visibility })) throw new Error('Você não pode rolar assim')
  if (!rollLimit(member.userId)) throw new Error('Calma! Muitas rolagens seguidas')
  const a = p.actorId ? await ownedActor(s, p.actorId) : null
  if (p.actorId && !a) throw new Error('Você não controla esse personagem')
  const r = roll(p.formula, p.refs ?? (a ? await refsOfActor(a.id) : {}))
  return publish(io, s, { roll: { ...r, label: p.label }, visibility: p.visibility }, a)
}

// Iniciativa (C2): um clique do mestre publica várias de uma vez, então não passa pelo limite nem pelo dado 3D.
// A de combatente oculto vai sem destinatário: só o mestre recebe, e o jogador não fica sabendo que houve rolagem (C7).
export const postInitiative = (io: IO, s: S, r: RollResult, name: string, hidden: boolean) =>
  publish(io, s, { roll: { ...r, label: `Iniciativa — ${name}` }, visibility: hidden ? 'private' : 'public' }, null, { quiet: true })

async function publish(io: IO, s: S, row: Partial<typeof chatMessage.$inferInsert>, a: { id: string; name: string } | null, extra: Pick<Message, 'quiet'> = {}) {
  const [saved] = await db.insert(chatMessage).values({ ...row, campaignId: s.data.campaignId, authorId: s.data.member.userId, actorId: a?.id ?? null }).returning()
  // A foto vem do banco, não da sessão: trocá-la no perfil vale sem reconectar.
  const [pref] = await db.select({ color: membership.diceColor, image: user.image }).from(membership).innerJoin(user, eq(user.id, membership.userId)).where(and(eq(membership.campaignId, s.data.campaignId), eq(membership.userId, s.data.member.userId)))
  const msg = { ...toMessage({ ...saved!, authorName: s.data.userName, authorImage: pref?.image ?? null, actorName: a?.name ?? null }), color: pref?.color, ...extra }
  await emitFiltered(io, s.data.campaignId, 'chat:new', (o) => viewMessage(msg, o.data.member) ?? undefined)
  return msg
}

export function registerChat(io: IO, s: S) {
  const { campaignId } = s.data

  s.on('chat:send', handler(Send.parse, async ({ text, actorId, visibility }) => {
    const member = await refreshMember(s)
    if (!member || member.role === 'observer') throw new Error('Observador só assiste')
    if (!msgLimit(member.userId)) throw new Error('Calma! Muitas mensagens seguidas')

    const cmd = parseCommand(text)
    if (cmd.kind === 'roll') return { id: (await postRoll(io, s, { formula: cmd.formula, label: cmd.label, actorId, visibility })).id }

    const a = actorId ? await ownedActor(s, actorId) : null
    if (actorId && !a) throw new Error('Você não controla esse personagem')
    if (cmd.kind === 'whisper') {
      const members = await db.select({ id: user.id, name: user.name }).from(membership).innerJoin(user, eq(user.id, membership.userId)).where(eq(membership.campaignId, campaignId))
      const to = members.filter((m) => m.id !== member.userId && m.name.toLowerCase().startsWith(cmd.to.toLowerCase()))
      if (!to.length) throw new Error(`Ninguém na mesa se chama "${cmd.to}"`)
      return { id: (await publish(io, s, { text: cmd.text, visibility: 'private', toUserIds: to.map((m) => m.id) }, a)).id }
    }
    return { id: (await publish(io, s, { text: cmd.text, visibility: visibility === 'private' ? 'private' : 'public' }, a)).id }
  }))

  s.on('chat:history', handler(History.parse, async ({ before }) => {
    const rows = await db
      .select({ m: chatMessage, authorName: user.name, authorImage: user.image, actorName: actor.name })
      .from(chatMessage)
      .innerJoin(user, eq(user.id, chatMessage.authorId))
      .leftJoin(actor, eq(actor.id, chatMessage.actorId))
      .where(and(eq(chatMessage.campaignId, campaignId), before ? lt(chatMessage.createdAt, new Date(before)) : undefined))
      .orderBy(desc(chatMessage.createdAt))
      .limit(PAGE)
    // ponytail: filtra depois do LIMIT, então uma página pode vir com menos de 50 para quem não vê tudo
    const out = rows.map((r) => viewMessage(toMessage({ ...r.m, authorName: r.authorName, authorImage: r.authorImage, actorName: r.actorName }), s.data.member)).filter((m) => m !== null)
    return { messages: out.reverse(), more: rows.length === PAGE, cursor: rows.at(-1)?.m.createdAt.toISOString() ?? null }
  }))
}
