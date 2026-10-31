import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { db, membership, page as wikiPage, sheet, user } from '@grimorio/db'
import { requireMember } from '@/lib/session'
import { controlledActors } from '@/lib/actors'
import { PlayClient } from './play-client'

export default async function Play({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { member } = await requireMember(id)
  const actors = await controlledActors(id, member)
  const [sheets, members, pages] = await Promise.all([
    actors.length ? db.select({ id: sheet.id, actorId: sheet.actorId }).from(sheet).where(and(inArray(sheet.actorId, actors.map((a) => a.id)), isNull(sheet.alias))) : [],
    member.role === 'gm' ? db.select({ id: user.id, name: user.name }).from(membership).innerJoin(user, eq(user.id, membership.userId)).where(and(eq(membership.campaignId, id), ne(membership.role, 'gm'))) : [],
    db.select({ id: wikiPage.id, title: wikiPage.title }).from(wikiPage).where(and(eq(wikiPage.campaignId, id), isNull(wikiPage.ownerId), member.role === 'gm' ? undefined : ne(wikiPage.visibility, 'hidden'))).orderBy(wikiPage.title),
  ])
  // Jogador cai com a ficha do próprio personagem aberta; o mestre usa a biblioteca e a janela Fichas.
  const mine = member.role === 'gm' ? [] : actors.filter((a) => a.ownerIds.includes(member.userId))
  return (
    <PlayClient campaignId={id} members={members} pages={pages}
      actors={mine.map((a) => ({ id: a.id, name: a.name, avatarAssetId: a.avatarAssetId, sheetId: sheets.find((s) => s.actorId === a.id)?.id ?? null, pc: a.ownerIds.length > 0 }))} />
  )
}
