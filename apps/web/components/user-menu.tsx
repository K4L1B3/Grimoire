'use client'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { LogOut } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { UserPhoto } from './avatar'

export function UserMenu({ name, image }: { name: string; image?: string | null }) {
  const t = useTranslations('home')
  const locale = useLocale()
  const router = useRouter()
  // Idioma fica num cookie lido pelo servidor (i18n/request.ts).
  const setLocale = (l: string) => { document.cookie = `locale=${l}; path=/; max-age=31536000; samesite=lax`; router.refresh() }
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <select aria-label={t('language')} value={locale} onChange={(e) => setLocale(e.target.value)} className="rounded bg-transparent text-xs">
        <option value="pt">PT</option>
        <option value="en">EN</option>
      </select>
      <UserPhoto image={image} className="size-7" />
      <span>{name}</span>
      <button className="btn btn-ghost" aria-label={t('signOut')} title={t('signOut')} onClick={async () => { await authClient.signOut(); location.href = '/login' }}>
        <LogOut size={16} aria-hidden />
      </button>
    </div>
  )
}
