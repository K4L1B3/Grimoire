'use client'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Dices, Eye, EyeOff, GripVertical, LocateFixed, Plus, Shield, Skull, UserPlus, X } from 'lucide-react'
import type { CombatantView, Condition } from '@grimorio/core'
import { request, useRealtime, useSocketEvent } from '@/components/realtime'
import { ask } from '@/components/confirm'
import { Avatar } from '@/components/avatar'
import { EffectChip, EffectsDialog } from './effects-dialog'

export type CombatView = { round: number; combatants: CombatantView[] }
type Candidate = { id: string; name: string; image: string | null; pc: boolean }

// Tokens do mapa que ainda estão fora do combate: um clique e entram na ordem.
function TokenPicker({ sceneId, onError }: { sceneId: string; onError: (e: unknown) => void }) {
  const { socket } = useRealtime()
  const t = useTranslations('combat')
  const [list, setList] = useState<Candidate[]>([])
  const load = useCallback(() => { request<Candidate[]>(socket, 'combat:candidates', { sceneId }).then(setList).catch(onError) }, [socket, sceneId, onError])
  useEffect(load, [load])
  useSocketEvent('combat:state', load)
  useSocketEvent('token:sync', load)
  const add = (tokenIds: string[]) => request(socket, 'combat:start', { sceneId, tokenIds }).catch(onError)
  return (
    <section aria-label={t('addFromMap')} className="space-y-1.5 rounded-lg border border-line bg-bg/30 p-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted">{t('addFromMap')}</h3>
        {list.length > 1 && <button className="text-xs text-accent hover:underline" onClick={() => add(list.map((c) => c.id))}>{t('addAll')}</button>}
      </div>
      {!list.length && <p className="text-xs text-muted">{t('noTokens')}</p>}
      <ul className="flex flex-wrap gap-1.5">
        {list.map((c) => (
          <li key={c.id}>
            <button title={t('addToken', { name: c.name })} aria-label={t('addToken', { name: c.name })} onClick={() => add([c.id])}
              className="flex max-w-40 items-center gap-1.5 rounded-full border border-line bg-panel py-0.5 pr-2 pl-0.5 text-xs transition-all hover:-translate-y-px hover:border-accent">
              <Avatar {...c} className="size-6" /><span className="truncate">{c.name}</span><UserPlus size={12} className="shrink-0 text-muted" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Painel de combate (C1–C8): ordem, turnos, vida da ficha, condições, vida e inimigos ocultos.
// Janela de combate: busca o estado sozinha e segue as atualizações; "mostrar no mapa" avisa a mesa por um evento.
export function CombatWindow({ sceneId }: { sceneId: string }) {
  const { socket, me } = useRealtime()
  const [combat, setCombat] = useState<CombatView | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { request<CombatView | null>(socket, 'combat:get', { sceneId }).then(setCombat).catch((e) => setError(e.message)) }, [socket, sceneId])
  useSocketEvent<{ sceneId: string; combat: CombatView | null }>('combat:state', useCallback((m) => m.sceneId === sceneId && setCombat(m.combat), [sceneId]))
  return (
    <>
      {error && <p role="alert" className="px-3 pt-2 text-xs text-fumble">{error}</p>}
      <CombatPanel sceneId={sceneId} combat={combat} isGm={me.role === 'gm'} onError={(e) => setError((e as Error).message)}
        onFocus={(tokenId) => window.dispatchEvent(new CustomEvent('grimorio:focus-token', { detail: tokenId }))} />
    </>
  )
}

// Campo de número salvo ao sair ou no Enter; vazio vira null.
function NumField({ label, value, onSave, className }: { label: string; value: number | null | undefined; onSave: (v: number | null) => void; className: string }) {
  return (
    <input aria-label={label} title={label} inputMode="numeric" placeholder="–" className={className} defaultValue={value ?? ''} key={value ?? ''}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      onBlur={(e) => {
        const v = e.target.value.trim() === '' ? null : Number(e.target.value)
        if (v === (value ?? null)) return
        if (Number.isNaN(v)) e.target.value = String(value ?? '')
        else onSave(v)
      }} />
  )
}

export const hpColor = (r: number) => (r > 0.5 ? 'crit' : r > 0.25 ? 'accent' : 'fumble')
export const STATUS: Record<string, string> = { ileso: 'bg-crit/15 text-crit', ferido: 'bg-accent/15 text-accent', 'muito ferido': 'bg-fumble/15 text-fumble', 'caído': 'bg-bg text-muted' }

export function HpBar({ hp, max, label }: { hp: number; max: number; label: string }) {
  const ratio = Math.min(1, Math.max(0, hp / max)), color = hpColor(ratio)
  return (
    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.max(0, hp)}>
      <div className={`h-full rounded-full transition-[width] duration-300 ease-(--ease-out-soft) ${color === 'crit' ? 'bg-crit' : color === 'accent' ? 'bg-accent' : 'bg-fumble'}`} style={{ width: `${ratio * 100}%` }} />
    </div>
  )
}

// Vida: número e barra para quem pode ver; quem não pode vê só o estado (C6).
function Hp({ c, isGm, onApply }: { c: CombatantView; isGm: boolean; onApply: (input: string) => void }) {
  const t = useTranslations('combat')
  const ratio = c.hp != null && c.hpMax ? Math.min(1, Math.max(0, c.hp / c.hpMax)) : null
  const color = ratio != null ? hpColor(ratio) : null
  const value = c.hp != null && (
    <span className="flex items-baseline gap-0.5 tabular-nums">
      <span className={`text-lg leading-none font-semibold ${color === 'crit' ? 'text-crit' : color === 'accent' ? 'text-accent' : color === 'fumble' ? 'text-fumble' : ''}`}>{c.hp}</span>
      {c.hpMax != null && <span className="text-xs text-muted">/{c.hpMax}</span>}
    </span>
  )
  const down = c.hp != null && c.hp <= 0 && <span className="inline-flex items-center gap-1 text-xs text-fumble"><Skull size={13} aria-hidden /> {t('down')}</span>
  const bar = ratio != null && <HpBar hp={c.hp!} max={c.hpMax!} label={t('hp')} />
  if (!isGm) {
    if (value) return <div className="mt-1"><div className="flex items-center gap-2"><span className="text-[10px] font-medium tracking-wide text-muted uppercase">{t('hp')}</span>{value}{down}</div>{bar}</div>
    return c.status ? <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${STATUS[c.status] ?? 'bg-bg text-muted'}`}>{c.status}</span> : null
  }
  const signed = (form: HTMLFormElement, sign: string) => {
    const n = String(new FormData(form).get('hp')).trim().replace(/^[+-]/, '')
    if (!n) return
    onApply(sign + n)
    form.reset()
  }
  const unset = c.hp == null
  return (
    <form className="group/hp mt-1" onSubmit={(e) => {
      e.preventDefault()
      const input = String(new FormData(e.currentTarget).get('hp'))
      if (input.trim()) onApply(input)
      e.currentTarget.reset()
    }}>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium tracking-wide text-muted uppercase">{t('hp')}</span>
        {value || <span className="text-xs text-muted">{t('hpUnset')}</span>}
        {down}
        <span className="ml-auto flex items-center gap-1">
          <input name="hp" autoComplete="off" aria-label={unset ? t('setHpOf', { name: c.name }) : t('damageOf', { name: c.name })} placeholder={unset ? t('hpTotal') : '0'} className="w-12 rounded-md border border-line bg-bg/60 px-1 py-0.5 text-center tabular-nums outline-none focus:border-accent" />
          {unset
            ? <button className="btn px-1.5 py-0.5 text-xs text-accent">{t('setHp')}</button>
            : <>
              <button type="button" className="btn px-1.5 py-0.5 text-xs text-fumble" onClick={(e) => signed(e.currentTarget.form!, '-')}>{t('damage')}</button>
              <button type="button" className="btn px-1.5 py-0.5 text-xs text-crit" onClick={(e) => signed(e.currentTarget.form!, '+')}>{t('heal')}</button>
            </>}
        </span>
      </div>
      <p className="mt-1 hidden text-[10px] text-muted group-focus-within/hp:block">{unset ? t('setHpHint') : t('hpHint')}</p>
      {bar}
    </form>
  )
}

export function CombatPanel({ sceneId, combat, isGm, onError, onFocus }: { sceneId: string; combat: CombatView | null; isGm: boolean; onError: (e: unknown) => void; onFocus: (tokenId: string) => void }) {
  const { socket } = useRealtime()
  const t = useTranslations('combat')
  const [dragId, setDragId] = useState<string | null>(null)
  const [effectsFor, setEffectsFor] = useState<string | null>(null)
  const go = (event: string, payload: object = {}) => request(socket, event, { sceneId, ...payload }).catch(onError)
  const patch = (id: string, p: object) => go('combat:patch', { id, patch: p })
  const toggleEffect = (c: CombatantView, name: string, rounds?: number) => {
    const same = (k: Condition) => k.name.toLowerCase() === name.toLowerCase()
    patch(c.id, { conditions: c.conditions.some(same) ? c.conditions.filter((k) => !same(k)) : [...c.conditions, { name, rounds }] })
  }

  if (!combat) {
    return (
      <div className="space-y-3 p-3 text-sm">
        <h2 className="font-serif text-xl">{t('title')}</h2>
        <p className="text-muted">{isGm ? t('emptyGm') : t('empty')}</p>
        {isGm && <TokenPicker sceneId={sceneId} onError={onError} />}
        {isGm && <QuickNpc onAdd={(n) => go('combat:addNpc', n)} />}
      </div>
    )
  }

  const list = combat.combatants
  const turn = list.findIndex((c) => c.current)
  const missing = list.filter((c) => c.init == null).length
  const effectsOf = list.find((c) => c.id === effectsFor)
  return (
    <div className="text-sm">
      <header className="sticky top-0 z-10 space-y-2 border-b border-line bg-panel p-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-xl leading-tight">{t('round', { n: combat.round })}</h2>
            {turn >= 0 && (
              <p className="truncate text-xs text-muted">
                {t('turnOf')} <span className="font-medium text-accent">{list[turn]!.name}</span>
                {list.length > 1 && <> · {t('upNext')} <span className="text-ink">{list[(turn + 1) % list.length]!.name}</span></>}
              </p>
            )}
          </div>
          {isGm && (
            <span className="flex shrink-0 gap-1">
              <button className={`btn px-2 py-1 text-xs ${missing ? 'border-accent text-accent' : ''}`} onClick={async () => { if (missing) go('combat:rollInit'); else if (await ask(t('rerollConfirm'), t('reroll'))) go('combat:rollInit', { all: true }) }} title={t(missing ? 'initiativeHint' : 'rerollHint')}><Dices size={14} /> {missing ? `${t('initiative')} (${missing})` : t('reroll')}</button>
              <button className="btn btn-ghost px-2 py-1 text-xs text-fumble" onClick={async () => { if (await ask(t('endConfirm'), t('end'))) go('combat:end') }}>{t('end')}</button>
            </span>
          )}
        </div>
        {isGm && (
          <div className="flex gap-1">
            <button className="btn px-3" onClick={() => go('combat:prev')} aria-label={t('prev')}><ChevronLeft size={16} /></button>
            <button className="btn btn-primary flex-1" onClick={() => go('combat:next')}>{t('next')} <ChevronRight size={16} /></button>
          </div>
        )}
      </header>

      {effectsOf && <EffectsDialog name={effectsOf.name} active={effectsOf.conditions.map((k) => k.name)} combat onClose={() => setEffectsFor(null)} onToggle={(name, rounds) => toggleEffect(effectsOf, name, rounds)} />}
      <div className="space-y-3 p-3">
        <ol className="space-y-1.5">
          {list.map((c) => (
            <li key={c.id} draggable={isGm} aria-current={c.current ? 'true' : undefined}
              onDragStart={() => setDragId(c.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (!dragId || dragId === c.id) return
                const ids = list.map((x) => x.id).filter((x) => x !== dragId)
                ids.splice(ids.indexOf(c.id), 0, dragId)
                go('combat:order', { ids })
              }}
              className={`rounded-xl border p-2 transition-colors ${c.current ? 'border-accent bg-accent/10 shadow-[inset_3px_0_0_var(--color-accent)]' : 'border-line bg-bg/30'} ${c.hidden ? 'opacity-60' : ''}`}>
              <div className="flex items-stretch gap-2">
                {isGm && <GripVertical size={14} aria-hidden className="shrink-0 cursor-grab self-center text-muted" />}
                <div className={`flex w-12 shrink-0 flex-col items-center justify-center rounded-lg ${c.current ? 'bg-accent/20' : 'bg-bg/70'}`}>
                  <span className="text-[9px] font-medium tracking-wide text-muted uppercase">{t('init')}</span>
                  {isGm
                    ? <NumField label={t('initOf', { name: c.name })} value={c.init} onSave={(init) => patch(c.id, { init })} className="w-full bg-transparent text-center font-serif text-2xl leading-none tabular-nums outline-none placeholder:text-muted" />
                    : <span className="font-serif text-2xl leading-none tabular-nums">{c.init ?? '–'}</span>}
                </div>
                <Avatar name={c.name} image={c.image} pc={c.pc} className="size-12 self-center" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <button className={`min-w-0 flex-1 truncate text-left text-base font-medium hover:text-accent ${c.hp != null && c.hp <= 0 ? 'text-muted line-through' : ''}`} title={c.name} onClick={() => c.tokenId && onFocus(c.tokenId)}>{c.name}</button>
                    {(isGm || c.ac != null) && (
                      <span className="relative grid size-8 shrink-0 place-items-center text-muted" title={t('ac')}>
                        <Shield size={32} strokeWidth={1.25} aria-hidden className="absolute" />
                        {isGm
                          ? <NumField label={t('acOf', { name: c.name })} value={c.ac} onSave={(ac) => patch(c.id, { ac })} className="relative w-6 bg-transparent text-center text-xs font-semibold text-ink tabular-nums outline-none placeholder:text-muted" />
                          : <span className="relative text-xs font-semibold text-ink tabular-nums">{c.ac}</span>}
                      </span>
                    )}
                    {(isGm || c.dc != null) && (
                      <span className="flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded-md border border-line leading-none" title={t('dcOf', { name: c.name })}>
                        <span className="text-[8px] font-medium text-muted">{t('dc')}</span>
                        {isGm
                          ? <NumField label={t('dcOf', { name: c.name })} value={c.dc} onSave={(dc) => patch(c.id, { dc })} className="w-6 bg-transparent text-center text-xs font-semibold text-ink tabular-nums outline-none placeholder:text-muted" />
                          : <span className="text-xs font-semibold text-ink tabular-nums">{c.dc}</span>}
                      </span>
                    )}
                    {isGm && (
                      <>
                        <button aria-label={c.hidden ? t('reveal') : t('hide')} title={c.hidden ? t('reveal') : t('hide')} onClick={() => patch(c.id, { hidden: !c.hidden })} className="rounded p-1 text-muted transition-colors hover:text-ink">{c.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                        <button aria-label={t('remove', { name: c.name })} title={t('remove', { name: c.name })} onClick={() => go('combat:remove', { id: c.id })} className="rounded p-1 text-muted transition-colors hover:text-fumble"><X size={14} /></button>
                      </>
                    )}
                    {c.tokenId && !isGm && <button aria-label={t('showOnMap')} title={t('showOnMap')} onClick={() => onFocus(c.tokenId!)} className="rounded p-1 text-muted hover:text-ink"><LocateFixed size={14} /></button>}
                  </div>
                  <Hp c={c} isGm={isGm} onApply={(input) => go('combat:hp', { id: c.id, input })} />
                </div>
              </div>
              {(c.conditions.length > 0 || isGm) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
                  {c.conditions.map((k) => (
                    <EffectChip key={k.name} name={k.name} rounds={k.rounds}>
                      {isGm && <button aria-label={t('removeCondition', { name: k.name })} onClick={() => toggleEffect(c, k.name)}><X size={10} /></button>}
                    </EffectChip>
                  ))}
                  {isGm && <button aria-label={t('conditionFor', { name: c.name })} onClick={() => setEffectsFor(c.id)} className="rounded-full px-2 py-0.5 text-muted transition-colors hover:bg-bg hover:text-ink">{t('conditionPh')}</button>}
                  {isGm && (
                    <select aria-label={t('hpModeOf', { name: c.name })} title={t('hpModeOf', { name: c.name })} className="ml-auto rounded-md border border-line bg-bg/60 px-1 py-0.5 text-muted" value={c.hpMode} onChange={(e) => patch(c.id, { hpMode: e.target.value })}>
                      <option value="exact">{t('exact')}</option><option value="status">{t('status')}</option><option value="none">{t('nothing')}</option>
                    </select>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
        {isGm && (
          <>
            <TokenPicker sceneId={sceneId} onError={onError} />
            <QuickNpc onAdd={(n) => go('combat:addNpc', n)} />
          </>
        )}
      </div>
    </div>
  )
}

function QuickNpc({ onAdd }: { onAdd: (n: { name: string; hp: number | null; ac: number | null; init: number | null }) => void }) {
  const t = useTranslations('combat')
  const num = (v: FormDataEntryValue | null) => (v ? Number(v) : null)
  return (
    <form className="flex gap-1" onSubmit={(e) => {
      e.preventDefault()
      const f = new FormData(e.currentTarget)
      onAdd({ name: String(f.get('name')), hp: num(f.get('hp')), ac: num(f.get('ac')), init: num(f.get('init')) })
      e.currentTarget.reset()
    }}>
      <input name="name" required placeholder={t('npc')} aria-label={t('npcName')} className="input min-w-0 flex-1 py-1" />
      <input name="hp" type="number" placeholder={t('hp')} aria-label={t('npcHp')} className="input w-14 px-2 py-1" />
      <input name="ac" type="number" placeholder={t('ac')} aria-label={t('npcAc')} className="input w-14 px-2 py-1" />
      <input name="init" type="number" placeholder={t('init')} aria-label={t('npcInit')} className="input w-14 px-2 py-1" />
      <button className="btn px-2" aria-label={t('addNpc')}><Plus size={14} /></button>
    </form>
  )
}
