import { eq } from 'drizzle-orm'
import { db, membership, user } from '@grimorio/db'
import { requireMember } from '@/lib/session'
import { systemAvatars } from '@/lib/avatars'
import { Settings } from './settings'

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { campaign, member, prefs, user: me } = await requireMember(id)
  const isGm = member.role === 'gm'
  const members = isGm
    ? await db.select({ userId: user.id, name: user.name, email: user.email, image: user.image, role: membership.role }).from(membership).innerJoin(user, eq(user.id, membership.userId)).where(eq(membership.campaignId, id)).orderBy(user.name)
    : []
  return (
    <Settings
      campaign={{ id, name: campaign.name, ownerId: campaign.ownerId, inviteCode: isGm ? campaign.inviteCode : '', cover: campaign.coverAssetId }}
      me={member}
      profile={{ name: me.name, image: me.image }}
      avatars={await systemAvatars()}
      prefs={prefs}
      members={members}
    />
  )
}
