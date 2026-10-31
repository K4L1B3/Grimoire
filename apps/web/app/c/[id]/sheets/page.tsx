import { and, eq, inArray, ne } from 'drizzle-orm'
import { db, membership, sheet, sheetTemplate, user } from '@grimorio/db'
import { requireMember } from '@/lib/session'
import { controlledActors } from '@/lib/actors'
import { SheetsHome } from './sheets-home'

export default async function SheetsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { member } = await requireMember(id)
  const actors = await controlledActors(id, member)
  const [templates, sheets, members] = await Promise.all([
    db.select({ id: sheetTemplate.id, name: sheetTemplate.name }).from(sheetTemplate).where(eq(sheetTemplate.campaignId, id)).orderBy(sheetTemplate.name),
    actors.length ? db.select({ id: sheet.id, actorId: sheet.actorId, alias: sheet.alias, templateId: sheet.templateId }).from(sheet).where(inArray(sheet.actorId, actors.map((a) => a.id))) : [],
    // Observador não abre ficha, nem sendo dono: não entra na lista de quem joga.
    member.role === 'gm' ? db.select({ id: user.id, name: user.name, role: membership.role }).from(membership).innerJoin(user, eq(user.id, membership.userId)).where(and(eq(membership.campaignId, id), ne(membership.role, 'observer'))) : [],
  ])
  return <SheetsHome campaignId={id} me={member} templates={templates} actors={actors.map((a) => ({ ...a, sheets: sheets.filter((s) => s.actorId === a.id) }))} members={members} />
}
