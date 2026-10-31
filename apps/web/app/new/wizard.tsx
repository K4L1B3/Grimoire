'use client'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import Link from 'next/link'
import { Check, Copy } from 'lucide-react'
import { createCampaign, createScene, createTemplate, updateCampaign } from '../campaign-actions'
import { DropZone } from '@/components/drop-zone'
import { upload } from '@/lib/upload'

const baseName = (f: File) => f.name.replace(/\.[^.]+$/, '')

// Assistente de 4 passos (SDD "Primeiro uso"): nome → ficha (opcional) → mapa → capa (opcional) → link de convite.
export function Wizard() {
  const t = useTranslations('wizard')
  const tc = useTranslations('common')
  const [step, setStep] = useState(0)
  const [campaignId, setCampaignId] = useState('')
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const finish = () => run(async () => {
    const res = await fetch(`/c/${campaignId}/invite`)
    setInvite(`${location.origin}/join/${await res.text()}`)
    setStep(4)
  })

  const steps = [t('steps.campaign'), t('steps.sheet'), t('steps.map'), t('steps.cover')]
  return (
    <div className="glass animate-enter space-y-6 rounded-2xl p-6">
      {step < 4 && (
        <ol className="flex gap-2 text-xs text-muted">
          {steps.map((s, i) => (
            <li key={s} className={`flex-1 transition-colors duration-300 ${i <= step ? 'text-ink' : ''}`}>
              <span className="mb-2 block h-0.5 overflow-hidden rounded bg-line">
                <span className={`block h-full origin-left bg-accent transition-transform duration-500 ease-(--ease-out-soft) ${i <= step ? 'scale-x-100' : 'scale-x-0'}`} />
              </span>
              {i + 1}. {s}
            </li>
          ))}
        </ol>
      )}

      {step === 0 && (
        <form className="animate-rise space-y-4" onSubmit={(e) => {
          e.preventDefault()
          const name = String(new FormData(e.currentTarget).get('name'))
          run(async () => { setCampaignId((await createCampaign(name)).id); setStep(1) })
        }}>
          <h1 className="font-serif text-2xl">{t('nameQ')}</h1>
          <input name="name" required autoFocus maxLength={80} className="input" placeholder={t('namePh')} />
          <button disabled={busy} className="btn btn-primary w-full">{t('continue')}</button>
        </form>
      )}

      {step === 1 && (
        <div key={step} className="animate-rise space-y-4">
          <h1 className="font-serif text-2xl">{t('sheetQ')}</h1>
          <p className="text-sm text-muted">{t('sheetHint')}</p>
          <DropZone accept="application/pdf" label={t('sheetDrop')} busy={busy} onFile={(f) => run(async () => {
            const a = await upload(campaignId, f, 'pdf')
            await createTemplate(campaignId, a.id, baseName(f))
            setStep(2)
          })} />
          <button className="btn btn-ghost w-full" onClick={() => setStep(2)}>{tc('skip')}</button>
        </div>
      )}

      {step === 2 && (
        <div key={step} className="animate-rise space-y-4">
          <h1 className="font-serif text-2xl">{t('mapQ')}</h1>
          <p className="text-sm text-muted">{t('mapHint')}</p>
          <DropZone accept="image/*" label={t('mapDrop')} busy={busy} onFile={(f) => run(async () => {
            const a = await upload(campaignId, f, 'map')
            await createScene(campaignId, a.id, baseName(f))
            setStep(3)
          })} />
          <button className="btn btn-ghost w-full" onClick={() => setStep(3)}>{tc('skip')}</button>
        </div>
      )}

      {step === 3 && (
        <div key={step} className="animate-rise space-y-4">
          <h1 className="font-serif text-2xl">{t('coverQ')}</h1>
          <p className="text-sm text-muted">{t('coverHint')}</p>
          <DropZone accept="image/*" label={t('coverDrop')} busy={busy} onFile={(f) => run(async () => {
            await updateCampaign(campaignId, { coverAssetId: (await upload(campaignId, f, 'image')).id })
            await finish()
          })} />
          <button className="btn btn-ghost w-full" disabled={busy} onClick={finish}>{tc('skip')}</button>
        </div>
      )}

      {step === 4 && (
        <div key={step} className="animate-rise space-y-4">
          <h1 className="font-serif text-2xl">{t('doneTitle')}</h1>
          <p className="text-sm text-muted">{t('doneHint')}</p>
          <div className="flex gap-2">
            <input readOnly value={invite} className="input font-mono text-xs" onFocus={(e) => e.target.select()} />
            <button className="btn" aria-label={t('copy')} onClick={() => (navigator.clipboard.writeText(invite), setCopied(true))}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <Link href={`/c/${campaignId}/play`} className="btn btn-primary w-full">{t('open')}</Link>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-fumble">{error}</p>}
    </div>
  )
}
