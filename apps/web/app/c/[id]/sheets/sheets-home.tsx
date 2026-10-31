'use client'
import { ask } from '@/components/confirm'
import { useTranslations } from 'next-intl'
import { useEffect, useOptimistic, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Camera, Check, FileText, Loader2, Pencil, PenSquare, Plus, Trash2, UserPlus, X } from 'lucide-react'
import type { Member } from '@grimorio/core'
import { Avatar } from '@/components/avatar'
import { DropZone } from '@/components/drop-zone'
import { upload } from '@/lib/upload'
import { createTemplate } from '../../../campaign-actions'
import { addSheet, createActor, deleteActor, deleteSheet, deleteTemplate, updateActor } from './actions'

type Template = { id: string; name: string }
type Actor = { id: string; name: string; avatarAssetId: string | null; ownerIds: string[]; sheets: { id: string; alias: string | null; templateId: string }[] }
type Person = { id: string; name: string; role: string }
type Act = (fn: () => Promise<unknown>) => void

type Props = {
  campaignId: string
  me: Member
  templates: Template[]
  actors: Actor[]
  members: Person[]
}

export function SheetsHome({ campaignId, me, templates, actors, members }: Props) {
  const router = useRouter()
  const t = useTranslations('sheets')
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newOwners, setNewOwners] = useState<string[]>([])
  const isGm = me.role === 'gm'
  // O revalidatePath das actions já devolve a tela nova na mesma resposta; um router.refresh() aqui renderizaria tudo duas vezes.
  const act: Act = (fn) => start(async () => {
    setError('')
    setSaved(false)
    try { await fn(); setSaved(true) } catch (e) { setError((e as Error).message) }
  })
  useEffect(() => {
    if (!saved) return
    const id = setTimeout(() => setSaved(false), 2000)
    return () => clearTimeout(id)
  }, [saved])

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-8">
      <header>
        <h1 className="font-serif text-3xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{isGm ? t('introGm') : t('introPlayer')}</p>
      </header>
      {error && (
        <p role="alert" className="sticky top-2 z-20 flex animate-rise items-center justify-between gap-3 rounded-lg border border-fumble/60 bg-panel px-3 py-2 text-sm text-fumble shadow-lg shadow-black/30">
          {error}
          <button className="shrink-0 hover:text-ink" aria-label={t('dismiss')} onClick={() => setError('')}><X size={14} /></button>
        </p>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">{t('characters')}</h2>
          {me.role !== 'observer' && templates.length > 0 && (
            <button className="btn" onClick={() => setCreating(!creating)}><UserPlus size={16} aria-hidden /> {t('newCharacter')}</button>
          )}
        </div>
        {creating && (
          <form className="card animate-rise space-y-4 p-4" onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            act(async () => {
              const owners = f.getAll('owners').map(String)
              const r = await createActor(campaignId, { name: String(f.get('name')), templateId: String(f.get('templateId') ?? ''), ownerIds: owners, kind: owners.length || !isGm ? 'character' : 'creature' })
              setCreating(false)
              setNewOwners([])
              if (r.sheetId) router.push(`/c/${campaignId}/sheets/${r.sheetId}`)
            })
          }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="label">{t('name')}</span><input name="name" required className="input" autoFocus /></label>
              <label><span className="label">{t('template')}</span>
                <select name="templateId" className="input">{templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}{isGm && <option value="">{t('npc')}</option>}</select>
              </label>
            </div>
            {isGm && (
              <fieldset>
                <legend className="label">{t('owners')}</legend>
                <OwnerChips members={members} selected={newOwners} name="owners" onToggle={(id) => setNewOwners((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]))} />
                <p className="mt-1.5 text-xs text-muted">{newOwners.length ? t('ownersHint') : t('ownersNew')}</p>
              </fieldset>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>{t('cancel')}</button>
              <button className="btn btn-primary" disabled={pending}>{t('create')}</button>
            </div>
          </form>
        )}
        {actors.length === 0 && !creating && <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">{templates.length ? t('none') : t('noTemplates')}</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {actors.map((a) => <ActorCard key={a.id} campaignId={campaignId} a={a} templates={templates} members={isGm ? members : null} act={act} />)}
        </ul>
      </section>

      {isGm && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-medium">{t('templates')}</h2>
            <p className="text-sm text-muted">{t('templatesHint')}</p>
          </div>
          {templates.length > 0 && (
            <ul className="card divide-y divide-line overflow-hidden">
              {templates.map((tp) => (
                <li key={tp.id} className="flex items-center gap-2 px-3 py-2">
                  <FileText size={16} className="shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{tp.name}</span>
                  <Link href={`/c/${campaignId}/sheets/t/${tp.id}`} className="btn"><PenSquare size={14} aria-hidden /> {t('editFields')}</Link>
                  <button className="btn btn-ghost text-muted hover:text-fumble" aria-label={t('deleteTemplate', { name: tp.name })} onClick={async () => { if (await ask(t('deleteTemplateConfirm', { name: tp.name }))) act(() => deleteTemplate(campaignId, tp.id)) }}><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
          )}
          <DropZone accept="application/pdf" busy={pending} label={t('dropPdf')} onFile={(f) => act(async () => {
            const a = await upload(campaignId, f, 'pdf')
            const t = await createTemplate(campaignId, a.id, f.name.replace(/\.pdf$/i, ''))
            router.push(`/c/${campaignId}/sheets/t/${t.id}`)
          })} />
        </section>
      )}

      <div role="status" className="pointer-events-none fixed bottom-6 left-1/2 z-[950] -translate-x-1/2">
        {(pending || saved) && (
          <span className="card flex animate-rise items-center gap-2 px-3 py-1.5 text-sm">
            {pending ? <Loader2 size={14} className="animate-spin text-muted" aria-hidden /> : <Check size={14} className="text-crit" aria-hidden />}
            {pending ? t('saving') : t('saved')}
          </span>
        )}
      </div>
    </div>
  )
}

// O link do nome se estica por cima do topo do cartão: clicar em qualquer ponto abre a ficha, e só os controles (z-10) ficam acima dele.
function ActorCard({ campaignId, a, templates, members, act }: { campaignId: string; a: Actor; templates: Template[]; members: Person[] | null; act: Act }) {
  const t = useTranslations('sheets')
  const [renaming, setRenaming] = useState(false)
  const main = a.sheets.find((s) => !s.alias) ?? a.sheets[0]
  const rename = (name: string) => {
    setRenaming(false)
    if (name.trim() && name.trim() !== a.name) act(() => updateActor(campaignId, a.id, { name }))
  }
  return (
    <li className="card flex flex-col overflow-hidden">
      <div className={`group relative flex flex-1 gap-3 p-3 transition-colors duration-150 ${main ? 'hover:bg-raised' : ''}`}>
        <span className="relative shrink-0 self-start">
          <Avatar name={a.name} image={a.avatarAssetId} pc={a.ownerIds.length > 0} className="size-16 text-lg!" />
          <label title={t('portrait')} className="absolute -right-1 -bottom-1 z-10 flex size-6 cursor-pointer items-center justify-center rounded-full border border-line bg-panel text-muted shadow transition-colors focus-within:border-accent hover:border-accent hover:text-accent">
            <Camera size={12} aria-hidden />
            <input type="file" accept="image/*" aria-label={t('portrait')} className="sr-only" onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) act(async () => updateActor(campaignId, a.id, { avatarAssetId: (await upload(campaignId, file, 'image')).id }))
            }} />
          </label>
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          {renaming
            ? <input defaultValue={a.name} autoFocus aria-label={t('characterName')} className="input relative z-10 px-2 py-1"
                onBlur={(e) => rename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') e.currentTarget.value = a.name
                  if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                }} />
            : main
              ? <Link href={`/c/${campaignId}/sheets/${main.id}`} aria-label={t('openSheetOf', { name: a.name })} className="block truncate font-medium transition-colors after:absolute after:inset-0 group-hover:text-accent">{a.name}</Link>
              : <p className="truncate font-medium">{a.name}</p>}
          {main
            ? <p className="flex items-center gap-1 text-xs text-muted transition-colors group-hover:text-accent">{t('openSheet')} <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" aria-hidden /></p>
            : <p className="text-xs text-muted">{t('noSheet')}</p>}
          <ul className="flex flex-wrap items-center gap-1 pt-1 text-xs">
            {a.sheets.filter((s) => s.alias).map((s) => (
              <li key={s.id} className="relative z-10 inline-flex items-center rounded-lg border border-line bg-panel">
                <Link className="px-2 py-0.5 transition-colors hover:text-accent" href={`/c/${campaignId}/sheets/${s.id}`}>{s.alias}</Link>
                <button className="pr-1.5 text-muted transition-colors hover:text-fumble" aria-label={t('deleteSheet', { name: s.alias ?? '' })} onClick={async () => { if (await ask(t('deleteSheetConfirm', { name: s.alias ?? '' }))) act(() => deleteSheet(campaignId, s.id)) }}><X size={12} /></button>
              </li>
            ))}
            {templates.length > 0 && <li className="relative z-10"><AddSheet templates={templates} needsAlias={a.sheets.some((s) => !s.alias)} onAdd={(tpl, alias) => act(() => addSheet(campaignId, a.id, tpl, alias))} /></li>}
          </ul>
        </div>
        <div className="relative z-10 flex self-start">
          <button className="btn btn-ghost p-1.5 text-muted" title={t('rename', { name: a.name })} aria-label={t('rename', { name: a.name })} onClick={() => setRenaming(true)}><Pencil size={14} /></button>
          <button className="btn btn-ghost p-1.5 text-muted hover:text-fumble" title={t('deleteActor', { name: a.name })} aria-label={t('deleteActor', { name: a.name })} onClick={async () => { if (await ask(t('deleteActorConfirm', { name: a.name }))) act(() => deleteActor(campaignId, a.id)) }}><Trash2 size={14} /></button>
        </div>
      </div>
      {members && <OwnerField campaignId={campaignId} a={a} members={members} act={act} />}
    </li>
  )
}

// A marcação muda na hora e a action salva por trás; se falhar, useOptimistic volta sozinho ao valor do servidor.
function OwnerField({ campaignId, a, members, act }: { campaignId: string; a: Actor; members: Person[]; act: Act }) {
  const t = useTranslations('sheets')
  const [owners, setOwners] = useOptimistic(a.ownerIds)
  return (
    <div className="border-t border-line bg-bg/30 p-3">
      <fieldset>
        <legend className="label">{t('owners')}</legend>
        <OwnerChips members={members} selected={owners} label={(m) => t('ownerOf', { player: m.name, name: a.name })} onToggle={(id) => act(() => {
          const next = owners.includes(id) ? owners.filter((o) => o !== id) : [...owners, id]
          setOwners(next)
          return updateActor(campaignId, a.id, { ownerIds: next })
        })} />
        <p className="mt-1.5 text-xs text-muted">{owners.length ? t('ownersHint') : t('ownersEmpty')}</p>
      </fieldset>
    </div>
  )
}

function OwnerChips({ members, selected, onToggle, name, label }: { members: Person[]; selected: string[]; onToggle: (id: string) => void; name?: string; label?: (m: Person) => string }) {
  const t = useTranslations('sheets')
  return (
    <div className="flex flex-wrap gap-1.5">
      {members.map((m) => (
        <label key={m.id} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1 text-sm transition-colors hover:border-accent/70 has-[:checked]:border-accent has-[:checked]:bg-accent/15">
          <input type="checkbox" name={name} value={m.id} checked={selected.includes(m.id)} aria-label={label?.(m)} onChange={() => onToggle(m.id)} className="accent-accent" />
          {m.name}
          {m.role === 'gm' && <span className="text-xs text-muted">{t('gmTag')}</span>}
        </label>
      ))}
    </div>
  )
}

function AddSheet({ templates, needsAlias, onAdd }: { templates: Template[]; needsAlias: boolean; onAdd: (templateId: string, alias: string) => void }) {
  const t = useTranslations('sheets')
  const [open, setOpen] = useState(false)
  if (!open) return <button className="btn btn-ghost px-2 py-0.5 text-xs text-muted" title={needsAlias ? t('extraSheetHint') : undefined} onClick={() => setOpen(true)}><Plus size={12} aria-hidden /> {needsAlias ? t('extraSheet') : t('addSheet')}</button>
  return (
    <form className="flex flex-wrap items-center gap-1" onSubmit={(e) => {
      e.preventDefault()
      const f = new FormData(e.currentTarget)
      onAdd(String(f.get('tpl')), String(f.get('alias') ?? ''))
      setOpen(false)
    }}>
      {templates.length > 1 && <select name="tpl" className="input w-auto max-w-40 px-1 py-0.5 text-xs" aria-label={t('template')}>{templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}</select>}
      {templates.length === 1 && <input type="hidden" name="tpl" value={templates[0]!.id} />}
      {needsAlias && <input name="alias" required autoFocus placeholder={t('aliasPlaceholder')} className="input w-32 px-1.5 py-0.5 text-xs" aria-label={t('alias')} />}
      <button className="btn px-2 py-0.5 text-xs">{t('create')}</button>
      <button type="button" className="btn btn-ghost p-1 text-muted" aria-label={t('cancel')} onClick={() => setOpen(false)}><X size={12} /></button>
    </form>
  )
}
