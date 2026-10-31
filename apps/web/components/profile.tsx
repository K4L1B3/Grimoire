'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Upload } from 'lucide-react'
import { updateProfile } from '@/app/profile-actions'
import { uploadAvatar } from '@/lib/upload'
import { DEFAULT_AVATAR, UserPhoto } from './avatar'

type PickerProps = { value?: string | null; avatars: string[]; disabled?: boolean; onChange: (image: string, file?: File) => void; children?: React.ReactNode }

// Avatares do sistema ou foto enviada; usado na modal do primeiro acesso e nos ajustes.
// `children` fica logo abaixo da foto em destaque: é onde entra o campo de nome.
export function AvatarPicker({ value, avatars, disabled, onChange, children }: PickerProps) {
  const t = useTranslations('profile')
  return (
    <div className="flex flex-col items-center gap-4">
      <UserPhoto image={value} className="size-48" />
      {children}
      <ul className="flex max-h-44 w-full flex-wrap justify-center gap-2 overflow-y-auto p-1">
        {avatars.map((a, i) => (
          <li key={a}>
            <button type="button" disabled={disabled} aria-label={t('avatar', { n: i + 1 })} aria-pressed={a === value} onClick={() => onChange(a)}
              className={`block rounded-full outline-offset-1 hover:outline-2 hover:outline-accent/70 ${a === value ? 'outline-2 outline-accent' : ''}`}>
              <UserPhoto image={a} className="size-20" />
            </button>
          </li>
        ))}
      </ul>
      <label className="btn cursor-pointer focus-within:border-accent">
        <Upload size={16} aria-hidden /> {t('upload')}
        <input type="file" accept="image/*" className="sr-only" disabled={disabled} onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onChange(URL.createObjectURL(f), f)
          e.target.value = ''
        }} />
      </label>
    </div>
  )
}

// Primeiro acesso: só sai daqui salvando. Quem não escolher nada fica com o avatar padrão.
export function ProfileModal({ name, avatars }: { name: string; avatars: string[] }) {
  const t = useTranslations('profile')
  const router = useRouter()
  const ref = useRef<HTMLDialogElement>(null)
  const [image, setImage] = useState(DEFAULT_AVATAR)
  const [file, setFile] = useState<File>()
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  useEffect(() => { ref.current?.showModal() }, [])

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const typed = String(new FormData(e.currentTarget).get('name'))
    start(async () => {
      setError('')
      try {
        await updateProfile({ name: typed, image: file ? undefined : image })
        if (file) await uploadAvatar(file)
        router.refresh()
      } catch (err) { setError((err as Error).message) }
    })
  }

  return (
    // onClose reabre porque o Chrome ignora o preventDefault do cancel no segundo Esc seguido.
    <dialog ref={ref} aria-labelledby="profile-title" onCancel={(e) => e.preventDefault()} onClose={() => ref.current?.showModal()}
      className="animate-pop m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-line bg-panel text-ink shadow-xl shadow-black/40 backdrop:bg-black/60">
      <form className="space-y-4 p-5" onSubmit={submit}>
        <div>
          <h2 id="profile-title" className="font-serif text-xl">{t('welcome')}</h2>
          <p className="mt-1 text-sm text-muted">{t('hint')}</p>
        </div>
        <AvatarPicker value={image} avatars={avatars} disabled={pending} onChange={(img, f) => { setImage(img); setFile(f) }}>
          <label className="block w-full"><span className="label">{t('name')}</span><input name="name" required maxLength={80} defaultValue={name} className="input" autoComplete="name" /></label>
        </AvatarPicker>
        {error && <p role="alert" className="text-sm text-fumble">{error}</p>}
        <div className="flex justify-end"><button className="btn btn-primary" disabled={pending}>{t('continue')}</button></div>
      </form>
    </dialog>
  )
}
