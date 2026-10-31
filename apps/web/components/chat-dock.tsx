'use client'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight, MessageSquare, Plus, X } from 'lucide-react'
import type { MessageView, RollVisibility } from '@grimorio/core'
import { UserPhoto } from './avatar'
import { request, useRealtime, useSocketEvent } from './realtime'
import { RollLine } from './roll-line'
import { deleteMacro, saveMacro } from '@/app/c/[id]/chat-actions'

type Macro = { id: string; name: string; formula: string }
const DICE = [4, 6, 8, 10, 12, 20]

export function ChatDock({ actors, macros: initialMacros }: { actors: { id: string; name: string }[]; macros: Macro[] }) {
  const { socket, me, campaignId, connected } = useRealtime()
  const t = useTranslations('chat')
  const [open, setOpen] = useState(true)
  const [messages, setMessages] = useState<MessageView[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [text, setText] = useState('')
  const [actorId, setActorId] = useState('')
  const [visibility, setVisibility] = useState<RollVisibility>('public')
  const [macros, setMacros] = useState(initialMacros)
  const [error, setError] = useState('')
  const list = useRef<HTMLOListElement>(null)
  const stick = useRef(true)

  const loadPage = useCallback(async (before: string | null) => {
    const res = await request<{ messages: MessageView[]; more: boolean; cursor: string | null }>(socket, 'chat:history', { before })
    setMessages((m) => (before ? [...res.messages, ...m] : res.messages))
    setMore(res.more)
    setCursor(res.cursor)
  }, [socket])

  // Ao (re)conectar, recarrega o histórico: nada se perde durante a queda.
  useEffect(() => {
    const load = () => { stick.current = true; loadPage(null).catch(() => {}) }
    if (socket.connected) load()
    socket.on('connect', load)
    return () => void socket.off('connect', load)
  }, [socket, loadPage])

  useSocketEvent<MessageView>('chat:new', useCallback((m) => setMessages((ms) => [...ms, m]), []))

  useLayoutEffect(() => {
    if (stick.current && list.current) list.current.scrollTop = list.current.scrollHeight
  }, [messages, open])

  const send = async (t: string) => {
    if (!t.trim()) return
    setError('')
    stick.current = true
    try {
      await request(socket, 'chat:send', { text: t, actorId: actorId || null, visibility })
      return true
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const canRoll = me.role !== 'observer'

  if (!open) {
    // Coluna própria, não flutuante: um painel à direita da tela dividida tamparia o botão.
    return (
      <div className="shrink-0 border-l border-line bg-panel p-1">
        <button className="btn btn-ghost px-2" onClick={() => setOpen(true)} aria-label={t('open')} title={t('open')}>
          <MessageSquare size={16} aria-hidden />
        </button>
      </div>
    )
  }

  return (
    <aside aria-label={t('aria')} className="flex w-80 shrink-0 flex-col border-l border-line bg-panel">
      <header className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="text-sm font-medium">
          {t('title')} {!connected && <span className="ml-1 text-xs text-fumble">· {t('reconnecting')}</span>}
        </h2>
        <button className="btn btn-ghost p-1" onClick={() => setOpen(false)} aria-label={t('close')}><ChevronRight size={16} aria-hidden /></button>
      </header>

      <ol ref={list} aria-live="polite" className="flex-1 space-y-2 overflow-y-auto px-3 py-2 text-sm"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
        {more && (
          <li className="text-center">
            <button className="text-xs text-muted hover:text-ink" onClick={() => { stick.current = false; loadPage(cursor) }}>{t('earlier')}</button>
          </li>
        )}
        {messages.map((m) => <ChatItem key={m.id} m={m} me={me.userId} />)}
      </ol>

      {canRoll && (
        <div className="space-y-2 border-t border-line p-2">
          <div className="flex flex-wrap gap-1">
            {DICE.map((d) => (
              <button key={d} className="btn px-2 py-1 text-xs" onClick={() => send(`/r 1d${d}`)}>d{d}</button>
            ))}
            {/* D&D 5e: vantagem e desvantagem rolam 2d20 e ficam com o maior ou o menor. */}
            <button className="btn px-2 py-1 text-xs text-crit" title="2d20, fica o maior" onClick={() => send(`/r 2d20kh1 # ${t('advantage')}`)}>{t('adv')}</button>
            <button className="btn px-2 py-1 text-xs text-fumble" title="2d20, fica o menor" onClick={() => send(`/r 2d20kl1 # ${t('disadvantage')}`)}>{t('dis')}</button>
          </div>
          {(macros.length > 0 || text.startsWith('/r')) && (
            <div className="flex flex-wrap gap-1">
              {macros.map((m) => (
                <span key={m.id} className="group inline-flex items-center rounded-md border border-line text-xs">
                  <button className="px-2 py-1 hover:text-accent" title={m.formula} onClick={() => send(`/r ${m.formula} # ${m.name}`)}>{m.name}</button>
                  <button className="hidden px-1 text-muted group-hover:inline hover:text-fumble" aria-label={t('deleteMacro', { name: m.name })} onClick={() => deleteMacro(campaignId, m.id).then(() => setMacros((ms) => ms.filter((x) => x.id !== m.id)))}><X size={12} /></button>
                </span>
              ))}
              {text.startsWith('/r') && (
                <button className="btn px-2 py-1 text-xs" onClick={async () => {
                  const name = prompt(t('macroName'))
                  if (!name) return
                  try { const m = await saveMacro(campaignId, name, text); setMacros((ms) => [...ms, m]); setText('') } catch (e) { setError((e as Error).message) }
                }}><Plus size={12} aria-hidden /> {t('saveMacro')}</button>
              )}
            </div>
          )}
          <div className="flex gap-1">
            {actors.length > 0 && (
              <select className="input w-auto min-w-0 flex-1 px-2 py-1 text-xs" value={actorId} onChange={(e) => setActorId(e.target.value)} aria-label={t('speakAs')}>
                <option value="">{t('me')}</option>
                {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            <select className="input w-auto px-2 py-1 text-xs" value={visibility} onChange={(e) => setVisibility(e.target.value as RollVisibility)} aria-label={t('whoSees')}>
              <option value="public">{t('public')}</option>
              {me.role === 'gm' && <option value="hidden">{t('hidden')}</option>}
              <option value="private">{t('privateOpt')}</option>
            </select>
          </div>
          <form onSubmit={async (e) => { e.preventDefault(); if (await send(text)) setText('') }}>
            <input value={text} onChange={(e) => setText(e.target.value)} className="input" aria-label={t('input')}
              placeholder={t('placeholder')} />
          </form>
          {error && <p role="alert" className="text-xs text-fumble">{error}</p>}
        </div>
      )}
    </aside>
  )
}

function ChatItem({ m, me }: { m: MessageView; me: string }) {
  const t = useTranslations('chat')
  const who = 'actorName' in m && m.actorName ? m.actorName : m.authorName
  if ('hiddenRoll' in m) return (
    <li className="flex items-center gap-2 px-2 text-xs text-muted italic">
      <UserPhoto image={m.authorImage} className="size-7" />
      {t('hiddenRoll', { name: m.authorName })}
    </li>
  )
  const badge = m.visibility === 'hidden' ? t('gmOnly') : m.visibility === 'private' ? (m.toUserIds.length ? (m.authorId === me ? t('whisper') : t('whisperToYou')) : t('private')) : null
  return (
    <li className={`flex gap-2 rounded-md px-2 py-1.5 ${m.roll ? 'bg-bg' : ''}`}>
      <UserPhoto image={m.authorImage} className="size-7" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="font-medium text-accent">{who}</span>
          {badge && <span className="text-muted italic">{badge}</span>}
        </div>
        {m.roll ? <RollLine r={m.roll} label={m.label} /> : <p className="break-words whitespace-pre-wrap">{m.text}</p>}
      </div>
    </li>
  )
}
