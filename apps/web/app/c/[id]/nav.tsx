'use client'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, Home, Map, ScrollText, Settings, SlidersVertical } from 'lucide-react'
import { MusicPlayer } from '@/components/music-player'
import { useRealtime } from '@/components/realtime'
import { useWindows } from '@/components/windows'

// Barra lateral: ícone com rótulo. "Fichas" abre uma janela por cima, sem sair da mesa.
export function CampaignNav({ id, name }: { id: string; name: string }) {
  const path = usePathname()
  const t = useTranslations('nav')
  const { open, isOpen } = useWindows()
  const { me } = useRealtime()
  const item = 'flex w-14 flex-col items-center gap-0.5 rounded-lg py-2 text-[10px] font-medium transition-all duration-150 hover:bg-raised hover:text-ink active:scale-95'
  const links = [
    { href: `/c/${id}/play`, label: t('table'), icon: Map },
    { href: `/c/${id}/wiki`, label: t('wiki'), icon: BookOpen },
  ]
  return (
    <nav aria-label={name} className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2">
      <Link href="/" title={t('campaigns')} aria-label={t('campaigns')} className={`${item} mb-2 text-muted`}><Home size={20} aria-hidden /></Link>
      {links.map(({ href, label, icon: Icon }) => {
        const on = path.startsWith(href)
        return (
          <Link key={href} href={href} aria-current={on ? 'page' : undefined} className={`${item} ${on ? 'bg-raised text-accent' : 'text-muted'}`}>
            <Icon size={20} aria-hidden /> {label}
          </Link>
        )
      })}
      <button onClick={() => open({ kind: 'sheets', ref: 'all', title: t('sheets'), w: 420, h: 520, x: 84, y: 60 })} aria-pressed={isOpen('sheets', 'all')}
        className={`${item} ${isOpen('sheets', 'all') ? 'bg-raised text-accent' : 'text-muted'}`}>
        <ScrollText size={20} aria-hidden /> {t('sheets')}
      </button>
      {me.role === 'gm' && (
        <button onClick={() => open({ kind: 'sound', ref: 'board', title: t('sound'), w: 400, h: 680, x: 84, y: 40 })} aria-pressed={isOpen('sound', 'board')}
          className={`${item} ${isOpen('sound', 'board') ? 'bg-raised text-accent' : 'text-muted'}`}>
          <SlidersVertical size={20} aria-hidden /> {t('sound')}
        </button>
      )}
      <div className="mt-auto" />
      <MusicPlayer />
      <Link href={`/c/${id}/settings`} aria-current={path.startsWith(`/c/${id}/settings`) ? 'page' : undefined} className={`${item} ${path.startsWith(`/c/${id}/settings`) ? 'bg-raised text-accent' : 'text-muted'}`}>
        <Settings size={20} aria-hidden /> {t('settings')}
      </Link>
    </nav>
  )
}
