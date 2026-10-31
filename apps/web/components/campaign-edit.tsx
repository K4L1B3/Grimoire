'use client'
import { useTranslations } from 'next-intl'
import { useRef, useState, useTransition } from 'react'
import { ImagePlus, Pencil } from 'lucide-react'
import { updateCampaign } from '../app/campaign-actions'
import { upload } from '@/lib/upload'

// Lápis do cartão da home, só para o dono: nome e capa sem precisar entrar na mesa.
export function CampaignEdit({ id, name, hasCover, image }: { id: string; name: string; hasCover: boolean; image: string | null }) {
  const t = useTranslations('settings')
  const tc = useTranslations('common')
  const dialog = useRef<HTMLDialogElement>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const act = (fn: () => Promise<unknown>) => start(async () => {
    setError('')
    try { await fn() } catch (e) { setError((e as Error).message) }
  })
  const label = t('editCampaign', { name })

  return (
    <>
      <button title={label} aria-label={label} onClick={() => dialog.current?.showModal()}
        className="glass absolute right-2 top-2 grid size-9 place-items-center rounded-full opacity-0 transition-[opacity,color,scale] duration-200 hover:scale-110 hover:text-accent focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <Pencil size={16} aria-hidden />
      </button>
      <dialog ref={dialog} aria-label={label} onClick={(e) => e.target === dialog.current && dialog.current.close()}
        className="glass animate-pop m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl text-ink backdrop:bg-black/60 backdrop:backdrop-blur-sm">
        <div className="space-y-4 p-5">
          <label className="group/cover relative block aspect-video cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-line bg-cover bg-center" style={image ? { backgroundImage: `url(${image})` } : undefined}>
            <span className="glass absolute inset-x-0 bottom-3 mx-auto flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors group-hover/cover:text-accent">
              <ImagePlus size={16} aria-hidden /> {pending ? tc('loading') : t(hasCover ? 'changeCover' : 'chooseCover')}
            </span>
            <input type="file" accept="image/*" disabled={pending} className="sr-only" onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) act(async () => updateCampaign(id, { coverAssetId: (await upload(id, f, 'image')).id }))
            }} />
          </label>
          {hasCover
            ? <button type="button" className="btn btn-ghost w-full text-fumble" disabled={pending} onClick={() => act(() => updateCampaign(id, { coverAssetId: null }))}>{t('removeCover')}</button>
            : <p className="text-xs text-muted">{t('coverFallback')}</p>}
          <form className="flex gap-2" onSubmit={(e) => {
            e.preventDefault()
            const n = String(new FormData(e.currentTarget).get('name'))
            act(async () => { await updateCampaign(id, { name: n }); dialog.current?.close() })
          }}>
            <input name="name" required maxLength={80} defaultValue={name} className="input" aria-label={t('campaignName')} />
            <button className="btn btn-primary" disabled={pending}>{tc('save')}</button>
          </form>
          {error && <p role="alert" className="text-sm text-fumble">{error}</p>}
        </div>
      </dialog>
    </>
  )
}
