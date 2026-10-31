'use client'
import { ask, askText } from '@/components/confirm'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, LogOut, Pencil, RefreshCw } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import type { Member } from '@grimorio/core'
import { deleteCampaign, leaveCampaign, regenerateInvite, removeMember, setDicePrefs, setRole, updateCampaign } from '../../../campaign-actions'
import { updateProfile } from '../../../profile-actions'
import { upload, uploadAvatar } from '@/lib/upload'
import { UserPhoto } from '@/components/avatar'
import { AvatarPicker } from '@/components/profile'

type Props = {
  campaign: { id: string; name: string; ownerId: string; inviteCode: string; cover: string | null }
  me: Member
  profile: { name: string; image?: string | null }
  avatars: string[]
  prefs: { diceColor: string; dice3d: boolean }
  members: { userId: string; name: string; email: string; image: string | null; role: Member['role'] }[]
}

export function Settings({ campaign: c, me, profile, avatars, prefs, members }: Props) {
  const router = useRouter()
  const t = useTranslations('settings')
  const tc = useTranslations('common')
  const tp = useTranslations('profile')
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const act =(fn: () => Promise<unknown>) => start(async () => {
    setError('')
    try { await fn(); router.refresh() } catch (e) { setError((e as Error).message) }
  })
  const isGm = me.role === 'gm'
  const invite = typeof location === 'undefined' ? '' : `${location.origin}/join/${c.inviteCode}`

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
      <h1 className="font-serif text-3xl">{t('title')}</h1>
      {error && <p role="alert" className="text-sm text-fumble">{error}</p>}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{tp('title')}</h2>
        {editing ? (
          <AvatarPicker value={profile.image} avatars={avatars} disabled={pending} onChange={(image, file) => act(() => file ? uploadAvatar(file) : updateProfile({ image }))}>
            {/* Recarrega para o realtime, que guarda o nome ao conectar, passar a usar o novo. */}
            <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); const n = String(new FormData(e.currentTarget).get('name')); act(async () => { await updateProfile({ name: n }); location.reload() }) }}>
              <input name="name" required maxLength={80} defaultValue={profile.name} className="input" aria-label={tp('name')} />
              <button className="btn" disabled={pending}>{tc('save')}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>{tc('close')}</button>
            </form>
          </AvatarPicker>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <UserPhoto image={profile.image} className="size-48" />
            <div className="flex max-w-full items-center gap-1">
              <p className="truncate font-serif text-2xl">{profile.name}</p>
              <button className="btn btn-ghost size-8 shrink-0 p-0" title={tp('edit')} aria-label={tp('edit')} onClick={() => setEditing(true)}><Pencil size={16} /></button>
            </div>
          </div>
        )}
      </section>

      {me.userId === c.ownerId && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{t('campaign')}</h2>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = String(new FormData(e.currentTarget).get('name')); act(() => updateCampaign(c.id, { name: n })) }}>
            <input name="name" defaultValue={c.name} className="input" aria-label={t('campaignName')} />
            <button className="btn" disabled={pending}>{tc('save')}</button>
          </form>
          <label className="btn cursor-pointer">
            {c.cover ? t('changeCover') : t('chooseCover')}
            <input type="file" accept="image/*" hidden onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) act(async () => updateCampaign(c.id, { coverAssetId: (await upload(c.id, f, 'image')).id }))
            }} />
          </label>
        </section>
      )}

      {isGm && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{t('invite')}</h2>
          <div className="flex gap-2">
            <input readOnly value={invite} className="input font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={t('inviteLink')} suppressHydrationWarning />
            <button className="btn" aria-label={t('copy')} onClick={() => (navigator.clipboard.writeText(invite), setCopied(true))}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>
            <button className="btn" title={t('newLinkHint')} aria-label={t('newLink')} onClick={() => act(() => regenerateInvite(c.id))}><RefreshCw size={16} /></button>
          </div>
        </section>
      )}

      {isGm && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{t('people')}</h2>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 px-3 py-2">
                <UserPhoto image={m.image} className="size-8" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{m.name}</div>
                  <div className="truncate text-xs text-muted">{m.email}</div>
                </div>
                {m.userId === c.ownerId ? <span className="text-sm text-muted">{t('owner')}</span> : (
                  <>
                    <select className="input w-auto" value={m.role} aria-label={t('roleOf', { name: m.name })} onChange={(e) => act(() => setRole(c.id, m.userId, e.target.value as Member['role']))}>
                      <option value="gm">{tc('roles.gm')}</option>
                      <option value="player">{tc('roles.player')}</option>
                      <option value="observer">{tc('roles.observer')}</option>
                    </select>
                    <button className="btn btn-ghost text-fumble" onClick={async () => { if (await ask(t('removeConfirm', { name: m.name }))) act(() => removeMember(c.id, m.userId)) }}>{t('remove')}</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {me.role !== 'observer' && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{t('yourDice')}</h2>
          <label className="flex items-center gap-3">
            <input type="color" defaultValue={prefs.diceColor} onChange={(e) => act(() => setDicePrefs(c.id, { diceColor: e.target.value }))} />
            {t('diceColor')}
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" defaultChecked={prefs.dice3d} onChange={(e) => act(() => setDicePrefs(c.id, { dice3d: e.target.checked }))} />
            {t('dice3d')}
          </label>
        </section>
      )}

      <section className="flex flex-wrap gap-2 border-t border-line pt-6">
        <button className="btn" onClick={async () => { await authClient.signOut(); location.href = '/login' }}><LogOut size={16} aria-hidden /> {t('signOut')}</button>
        {me.userId === c.ownerId
          ? <button className="btn text-fumble" onClick={async () => { if ((await askText(t('deleteConfirm'))) === c.name) act(() => deleteCampaign(c.id)) }}>{t('delete')}</button>
          : <button className="btn text-fumble" onClick={async () => { if (await ask(t('leaveConfirm'))) act(() => leaveCampaign(c.id)) }}>{t('leave')}</button>}
      </section>
    </div>
  )
}
