import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { db, campaign, membership } from '@grimorio/db'
import { auth } from '@grimorio/db/auth'
import type { Member } from '@grimorio/core'

export const currentUser = cache(async () => (await auth.api.getSession({ headers: await headers() }))?.user ?? null)

export async function requireUser() {
  const user = await currentUser()
  if (!user) redirect('/login')
  return user
}

// Carrega a campanha e o papel do usuário nela; quem não é membro recebe 404 (não revela que a campanha existe).
export const requireMember = cache(async (campaignId: string) => {
  const user = await requireUser()
  const [row] = await db
    .select({ campaign, role: membership.role, diceColor: membership.diceColor, dice3d: membership.dice3d })
    .from(membership)
    .innerJoin(campaign, eq(campaign.id, membership.campaignId))
    .where(and(eq(membership.campaignId, campaignId), eq(membership.userId, user.id)))
  if (!row) notFound()
  const member: Member = { userId: user.id, role: row.role }
  return { user, member, campaign: row.campaign, prefs: { diceColor: row.diceColor, dice3d: row.dice3d } }
})

export async function requireGm(campaignId: string) {
  const ctx = await requireMember(campaignId)
  if (ctx.member.role !== 'gm') throw new Error('Só o mestre pode fazer isso')
  return ctx
}
