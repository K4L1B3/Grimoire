import { getFormatter, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { and, eq, sql } from 'drizzle-orm'
import { Plus } from 'lucide-react'
import { can, type Role } from '@grimorio/core'
import { db, campaign, membership, scene } from '@grimorio/db'
import { requireUser } from '@/lib/session'
import { CampaignEdit } from '@/components/campaign-edit'
import { LinkPending } from '@/components/link-pending'
import { UserMenu } from '@/components/user-menu'

// Capa escolhida → foto da última vez do próprio membro → mapa ativo. Mapa de masmorra entregaria ao jogador o que a névoa esconde.
function coverOf(c: { id: string; cover: string | null; seen: Date | null; map: string | null; dungeon: boolean | null; role: Role }, userId: string) {
  if (c.cover) return `/api/assets/${c.cover}`
  if (c.seen) return `/c/${c.id}/snapshot?v=${c.seen.getTime()}`
  if (c.map && (!c.dungeon || can({ userId, role: c.role }, 'fog.bypass', null))) return `/api/assets/${c.map}`
  return null
}

// Campanha sem imagem ganha um degradê próprio, sempre o mesmo para cada id.
const placeholder = (id: string) => {
  const hue = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360
  return `linear-gradient(135deg, hsl(${hue} 40% 30%), hsl(${hue + 40} 45% 16%))`
}

export default async function Home({ searchParams }: { searchParams: Promise<{ convite?: string }> }) {
  const user = await requireUser()
  const { convite } = await searchParams
  const t = await getTranslations('home')
  const tc = await getTranslations('common')
  const format = await getFormatter()
  const rows = await db
    .select({ id: campaign.id, name: campaign.name, cover: campaign.coverAssetId, ownerId: campaign.ownerId, role: membership.role, seen: membership.lastSeenAt, map: scene.assetId, dungeon: scene.dungeon })
    .from(membership)
    .innerJoin(campaign, eq(campaign.id, membership.campaignId))
    .leftJoin(scene, and(eq(scene.campaignId, campaign.id), eq(scene.active, true)))
    .where(eq(membership.userId, user.id))
    .orderBy(sql`${membership.lastSeenAt} desc nulls last`, campaign.name)
  const campaigns = rows.map((c) => ({ ...c, image: coverOf(c, user.id) }))
  const now = new Date()

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="ambient" aria-hidden style={campaigns[0]?.image ? { '--ambient-image': `url(${campaigns[0].image})` } as React.CSSProperties : undefined} />
      <header className="glass animate-enter sticky top-4 z-10 mb-8 flex items-center justify-between rounded-2xl px-5 py-2">
        <h1 className="font-serif text-3xl text-accent">Grimório</h1>
        <UserMenu name={user.name} image={user.image} />
      </header>
      {convite === 'invalido' && <p role="alert" className="mb-4 rounded-md bg-fumble/15 px-3 py-2 text-sm text-fumble">{t('inviteInvalid')}</p>}
      <h2 className="animate-enter mb-4 text-lg font-medium">{t('title')}</h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {campaigns.map((c, i) => (
          <li key={c.id} className="animate-enter" style={{ animationDelay: `${i * 70}ms` }}>
            <div className="cover-card group relative aspect-video overflow-hidden rounded-2xl border border-white/10 shadow-xl shadow-black/30 transition-[translate,scale,box-shadow,border-color] duration-300 ease-(--ease-out-soft) hover:-translate-y-1 hover:border-accent/60 hover:shadow-2xl hover:shadow-accent/10 has-[a:active]:translate-y-0 has-[a:active]:scale-[.96] has-[a:active]:border-accent has-[a:active]:duration-75 has-[[data-pending]]:translate-y-0 has-[[data-pending]]:scale-[.96] has-[[data-pending]]:border-accent">
              <Link href={`/c/${c.id}/play`} className="absolute inset-0 block">
                <div className="absolute inset-0 bg-cover bg-center transition-transform duration-700 ease-(--ease-out-soft) group-hover:scale-105" style={{ backgroundImage: c.image ? `url(${c.image})` : placeholder(c.id) }} />
                <div className="glass absolute inset-x-2 bottom-2 flex items-center justify-between gap-3 rounded-xl px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium transition-colors group-hover:text-accent">{c.name}</span>
                    {c.seen && <span className="block truncate text-xs text-muted">{t('seen', { when: format.relativeTime(c.seen, now) })}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{tc(`roles.${c.role}`)}</span>
                </div>
                <LinkPending />
              </Link>
              {c.ownerId === user.id && <CampaignEdit id={c.id} name={c.name} hasCover={!!c.cover} image={c.image} />}
            </div>
          </li>
        ))}
        <li className="animate-enter" style={{ animationDelay: `${campaigns.length * 70}ms` }}>
          <Link href="/new" className="glass group relative flex aspect-video flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-dashed border-white/20 text-muted transition-[translate,scale,border-color,color] duration-300 ease-(--ease-out-soft) hover:-translate-y-1 hover:border-accent hover:text-accent active:translate-y-0 active:scale-[.96] active:duration-75 has-[[data-pending]]:translate-y-0 has-[[data-pending]]:scale-[.96]">
            <Plus aria-hidden className="transition-transform duration-300 group-hover:rotate-90" /> {t('newCampaign')}
            <LinkPending />
          </Link>
        </li>
      </ul>
    </main>
  )
}
