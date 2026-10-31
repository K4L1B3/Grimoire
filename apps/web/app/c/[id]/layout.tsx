import { and, eq, ne } from 'drizzle-orm'
import { db, macro, membership, user as userTable } from '@grimorio/db'
import { requireMember } from '@/lib/session'
import { controlledActors } from '@/lib/actors'
import { Realtime } from '@/components/realtime'
import { ChatDock } from '@/components/chat-dock'
import { Dice3D } from '@/components/dice-3d'
import { SplitStage, WindowsProvider } from '@/components/windows'
import { CampaignWindows } from '@/components/window-contents'
import { WikiProvider } from '@/components/wiki/context'
import { CampaignNav } from './nav'

export default async function CampaignLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  const { campaign, member, user, prefs } = await requireMember(id)
  const [actors, macros, members] = await Promise.all([
    controlledActors(id, member),
    db.select({ id: macro.id, name: macro.name, formula: macro.formula }).from(macro).where(and(eq(macro.campaignId, id), eq(macro.userId, user.id))),
    // Jogadores, só para o mestre escolher quem vê segredos e pins.
    member.role === 'gm' ? db.select({ id: userTable.id, name: userTable.name, role: membership.role }).from(membership).innerJoin(userTable, eq(userTable.id, membership.userId)).where(and(eq(membership.campaignId, id), ne(membership.role, 'gm'))) : [],
  ])
  const withCharacters = members.map((m) => {
    const own = actors.filter((a) => a.ownerIds.includes(m.id))
    return { ...m, characters: own.map((a) => a.name), image: own.find((a) => a.avatarAssetId)?.avatarAssetId ?? null }
  })
  // Janelas e wiki ficam no layout: sobrevivem à navegação e abrem por cima da mesa.
  return (
    <Realtime campaignId={id} me={member}>
      <WikiProvider members={withCharacters} meName={user.name}>
        <WindowsProvider campaignId={id}>
          <div className="flex h-dvh overflow-hidden">
            <CampaignNav id={id} name={campaign.name} />
            <SplitStage windows={<CampaignWindows />}>{children}</SplitStage>
            <ChatDock actors={actors.map(({ id, name }) => ({ id, name }))} macros={macros} />
          </div>
          <Dice3D enabled={prefs.dice3d} />
        </WindowsProvider>
      </WikiProvider>
    </Realtime>
  )
}
