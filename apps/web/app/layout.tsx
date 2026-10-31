import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import { DialogHost } from '@/components/confirm'
import { ProfileModal } from '@/components/profile'
import { systemAvatars } from '@/lib/avatars'
import { currentUser } from '@/lib/session'
import './globals.css'

export const metadata: Metadata = { title: 'Grimório', description: 'Wiki, fichas e tabuleiro num só lugar' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const user = await currentUser()
  return (
    <html lang={locale === 'en' ? 'en' : 'pt-BR'}>
      {/* ponytail: extensões (ex.: ColorZilla) injetam atributos no body antes da hidratação */}
      <body className="min-h-dvh font-sans antialiased" suppressHydrationWarning>
        <NextIntlClientProvider>
          {children}
          <DialogHost />
          {/* Sem foto = perfil ainda não configurado (o Discord já traz nome e foto). */}
          {user && !user.image && <ProfileModal name={user.name} avatars={await systemAvatars()} />}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
