'use client'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { authClient } from '@/lib/auth-client'

const SLIDE_MS = 9000

export function LoginForm({ next, discord, wallpapers }: { next: string; discord: boolean; wallpapers: string[] }) {
  const t = useTranslations('auth')
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [slide, setSlide] = useState(0)

  useEffect(() => {
    if (wallpapers.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setSlide((s) => (s + 1) % wallpapers.length), SLIDE_MS)
    return () => clearInterval(id)
  }, [wallpapers.length])

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const email = String(f.get('email')), password = String(f.get('password'))
    setBusy(true)
    setError('')
    const res = mode === 'in'
      ? await authClient.signIn.email({ email, password })
      : await authClient.signUp.email({ email, password, name: String(f.get('name')) })
    setBusy(false)
    if (res.error) return setError(res.error.status === 429 ? t('tooMany') : res.error.message ?? t('failed'))
    location.href = next
  }

  // Duas camadas: a de trás some no vidro; a da frente é a imagem nítida do recorte em diagonal.
  const slides = wallpapers.map((src, i) => <img key={src} src={src} alt="" data-on={i === slide || undefined} className="auth-slide" />)

  return (
    <main data-mode={mode} className="auth flex min-h-dvh items-center justify-center p-4">
      <div className="auth-layer">{slides}</div>
      <div className="auth-glass" />
      <div className="auth-edge" />
      <div className="auth-layer auth-hero">{slides}</div>
      <div className="auth-card animate-enter space-y-4">
        <div className="text-center">
          <img src="/logos/grimoire-logo-icone.png" alt="" width={96} height={96} className="mx-auto mb-2 drop-shadow-lg" />
          <h1 className="font-serif text-4xl text-accent">Grimório</h1>
          <p key={mode} className="mt-1 animate-rise text-sm text-muted">{mode === 'in' ? t('greetIn') : t('greetUp')}</p>
        </div>
        {discord && (
          <>
            <button className="btn btn-primary w-full" onClick={() => authClient.signIn.social({ provider: 'discord', callbackURL: next })}>
              {t('discord')}
            </button>
            <p className="text-center text-xs text-muted">{t('or')}</p>
          </>
        )}
        <form onSubmit={submit} className="space-y-3">
          {mode === 'up' && (
            <label className="block animate-rise"><span className="label">{t('name')}</span><input name="name" required className="input" autoComplete="name" /></label>
          )}
          <label className="block"><span className="label">{t('email')}</span><input name="email" type="email" required className="input" autoComplete="email" /></label>
          <label className="block"><span className="label">{t('password')}</span><input name="password" type="password" required minLength={8} className="input" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></label>
          {error && <p role="alert" className="text-sm text-fumble">{error}</p>}
          <button disabled={busy} className={`btn w-full ${discord ? '' : 'btn-primary'}`}>{mode === 'in' ? t('signIn') : t('signUp')}</button>
        </form>
        <button className="w-full text-center text-sm text-muted hover:text-ink" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? t('toSignUp') : t('toSignIn')}
        </button>
      </div>
    </main>
  )
}
