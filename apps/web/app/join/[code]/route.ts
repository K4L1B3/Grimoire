import { eq } from 'drizzle-orm'
import { db, campaign, membership } from '@grimorio/db'
import { currentUser } from '@/lib/session'

// Link de convite: loga se precisar, entra como jogador e cai direto na mesa (SDD "Entrar na mesa").
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const user = await currentUser()
  const back = (path: string) => Response.redirect(new URL(path, process.env.BETTER_AUTH_URL ?? req.url), 303)
  if (!user) return back(`/login?next=/join/${encodeURIComponent(code)}`)
  const [c] = await db.select({ id: campaign.id }).from(campaign).where(eq(campaign.inviteCode, code))
  if (!c) return back('/?convite=invalido')
  await db.insert(membership).values({ campaignId: c.id, userId: user.id, role: 'player' }).onConflictDoNothing()
  return back(`/c/${c.id}/play`)
}
