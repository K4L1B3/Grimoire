'use client'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { Check, Lock, Trash2, Users, X } from 'lucide-react'
import { Avatar } from '../avatar'
import { request, useRealtime, useSocketEvent } from '../realtime'
import { CollabEditor } from './editor'
import { useWiki, type WikiMember } from './context'

// Escolha de quem vê: cada clique liga ou desliga na hora, sem botão de salvar (como os membros de um cartão do Trello).
function ShareDialog({ players, visibleTo, onToggle, onClose }: { players: WikiMember[]; visibleTo: string[]; onToggle: (id: string) => void; onClose: () => void }) {
  const t = useTranslations('wiki')
  const tc = useTranslations('common')
  const [q, setQ] = useState('')
  const found = players.filter((m) => [m.name, ...m.characters].some((s) => s.toLowerCase().includes(q.trim().toLowerCase())))
  // No body: dentro do editor, o ProseMirror pegaria as teclas da busca e o .wiki-prose mudaria o visual.
  return createPortal(
    <dialog ref={(d) => { if (d && !d.open) { d.showModal(); d.querySelector('input')?.focus() } }} onClose={onClose} onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-label={t('secretWho')} className="card m-auto w-full max-w-sm text-ink backdrop:bg-black/50">
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">{t('secretWho')}</h2>
          <button aria-label={tc('close')} onClick={onClose}><X size={16} /></button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('secretSearch')} aria-label={t('secretSearch')} className="input" />
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {found.map((m) => {
            const on = visibleTo.includes(m.id)
            return (
              <li key={m.id}>
                <button aria-pressed={on} onClick={() => onToggle(m.id)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left ${on ? 'bg-accent/10' : 'hover:bg-bg'}`}>
                  <Avatar name={m.name} image={m.image} pc className="size-8" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{m.name}</span>
                    {m.characters.length > 0 && <span className="block truncate text-xs text-muted">{m.characters.join(', ')}</span>}
                  </span>
                  {on && <Check size={16} className="shrink-0 text-accent" />}
                </button>
              </li>
            )
          })}
          {!found.length && <li className="px-2 py-1.5 text-sm text-muted">{t(players.length ? 'nothing' : 'secretNobody')}</li>}
        </ul>
        <p className="text-xs text-muted">{t('secretGmAlways')}</p>
      </div>
    </dialog>,
    document.body,
  )
}

// Conteúdo de um bloco secreto. Quem não tem acesso não recebe nada: nem o texto, nem o documento.
export function SecretView({ id, onRemove }: { id: string | null; onRemove?: () => void }) {
  const { socket } = useRealtime()
  const { members } = useWiki()
  const t = useTranslations('wiki')
  const [access, setAccess] = useState<{ canView: boolean; canEdit?: boolean; visibleTo?: string[] } | null>(null)
  const [sharing, setSharing] = useState(false)
  const load = useCallback(() => { if (id) request<typeof access>(socket, 'secret:get', { id }).then(setAccess).catch(() => setAccess({ canView: false })) }, [socket, id])
  useEffect(load, [load])
  useSocketEvent<{ id: string }>('secret:changed', useCallback((m) => m.id === id && load(), [id, load]))

  if (!id || !access?.canView) return null
  const visibleTo = access.visibleTo ?? []
  // Observador não lê segredo (SDD §3). ponytail: a permissão fica na pessoa, o personagem só identifica; se ele trocar de dono, o segredo não vai junto. Se isso importar, guardar ids de ator.
  const players = members.filter((m) => m.role === 'player')
  const chosen = players.filter((m) => visibleTo.includes(m.id))
  // Atualiza antes da resposta: cada clique envia a lista inteira, e dois cliques rápidos não podem partir da mesma lista velha.
  const toggle = (userId: string) => {
    const next = visibleTo.includes(userId) ? visibleTo.filter((x) => x !== userId) : [...visibleTo, userId]
    setAccess({ ...access, visibleTo: next })
    request(socket, 'secret:share', { id, visibleTo: next }).catch(load)
  }
  return (
    <div data-testid="secret" className="my-3 rounded-lg border border-dashed border-accent/60 bg-accent/5" contentEditable={false}>
      <div className="flex items-center gap-2 border-b border-accent/30 px-3 py-1 text-xs text-accent">
        <Lock size={12} /> Segredo
        {access.canEdit && (
          <>
            <button className="ml-auto flex items-center gap-2 text-muted hover:text-ink" aria-label={t('secretWho')} title={chosen.map((m) => m.name).join(', ')} onClick={() => setSharing(true)}>
              {chosen.length
                ? <span className="flex -space-x-1">{chosen.map((m) => <Avatar key={m.id} name={m.name} image={m.image} pc className="size-5" />)}</span>
                : t('secretOnlyGm')}
              <Users size={12} />
            </button>
            {onRemove && <button className="text-muted hover:text-fumble" aria-label="Apagar bloco secreto" onClick={onRemove}><Trash2 size={12} /></button>}
          </>
        )}
      </div>
      {sharing && <ShareDialog players={players} visibleTo={visibleTo} onToggle={toggle} onClose={() => setSharing(false)} />}
      <div className="px-3 py-1">
        <CollabEditor key={`${id}${access.canEdit}`} docName={`secret:${id}`} editable={!!access.canEdit} placeholder="Só quem está marcado lê isto." nested />
      </div>
    </div>
  )
}
