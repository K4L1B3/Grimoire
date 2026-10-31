import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { redirect } from 'next/navigation'
import { discordEnabled } from '@grimorio/db/auth'
import { currentUser } from '@/lib/session'
import { LoginForm } from './login-form'

// Wallpapers da entrada: toda imagem da pasta entra no revezamento, sem precisar mexer em código.
const WALLPAPERS = path.join(/*turbopackIgnore: true*/ process.cwd(), 'public/wallpaper-auth')

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  const to = next?.startsWith('/') && !next.startsWith('//') ? next : '/'
  if (await currentUser()) redirect(to)
  // Sem a pasta a tela fica sem fundo, mas ainda abre: ninguém pode ficar de fora por causa de uma imagem.
  const files = await readdir(WALLPAPERS).catch(() => [] as string[])
  const wallpapers = files.filter((f) => /\.(png|jpe?g|webp|avif)$/i.test(f)).sort().map((f) => `/wallpaper-auth/${f}`)
  return <LoginForm next={to} discord={discordEnabled} wallpapers={wallpapers} />
}
