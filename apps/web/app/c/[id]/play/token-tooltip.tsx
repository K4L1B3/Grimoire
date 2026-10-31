'use client'
import { useTranslations } from 'next-intl'
import { Dices, Heart, Shield, ShieldHalf, Skull, WandSparkles } from 'lucide-react'
import { effectOf, type CombatantView } from '@grimorio/core'
import type { TokenView } from './board-canvas'
import { Avatar } from '@/components/avatar'
import { HpBar, hpColor, STATUS } from './combat-panel'
import { EffectChip } from './effects-dialog'

const WIDTH = 256, GAP = 10
const HP_TEXT = { crit: 'text-crit', accent: 'text-accent', fumble: 'text-fumble' }

// Cartão ao passar o mouse no token. Só mostra o que o servidor mandou: quem não pode ver um número nem o recebe.
export function TokenTooltip({ token: tk, combatant: c, cell, view, area }: { token: TokenView; combatant?: CombatantView; cell: number; view: { x: number; y: number; scale: number }; area: HTMLElement }) {
  const t = useTranslations('combat')
  const tt = useTranslations('table')
  const size = cell * tk.size * view.scale
  const left = tk.x * view.scale + view.x, top = tk.y * view.scale + view.y
  // Abre do lado do token que tem espaço, para não sair da mesa.
  const fitsRight = left + size + GAP + WIDTH <= area.clientWidth
  const fitsDown = top + size / 2 < area.clientHeight / 2
  const hp = c ? c.hp : tk.stats.hp
  const max = c ? c.hpMax : tk.stats.hpMax
  // CA e CD vazias aparecem com traço para quem pode vê-las: o mestre descobre que falta preencher, em vez de não achar o campo.
  const stats = ([
    { label: t('ac'), icon: Shield, value: c?.ac ?? tk.stats.ac, always: tk.mine },
    { label: t('defense'), icon: ShieldHalf, value: tk.stats.defense },
    { label: t('dc'), icon: WandSparkles, value: c?.dc ?? tk.stats.dc, always: tk.mine },
    { label: t('init'), icon: Dices, value: c?.init },
  ]).filter((s) => s.value != null || s.always)
  return (
    <div role="tooltip" key={tk.id} className={`card pointer-events-none absolute z-20 animate-rise overflow-hidden bg-linear-to-b from-raised to-panel shadow-xl shadow-black/40 [animation-delay:150ms] [animation-fill-mode:backwards] ${c?.current ? 'border-accent/70' : ''}`}
      style={{
        width: WIDTH,
        ...(fitsRight ? { left: left + size + GAP } : { left: Math.max(GAP, left - GAP - WIDTH) }),
        ...(fitsDown ? { top: Math.max(GAP, top) } : { bottom: Math.max(GAP, area.clientHeight - top - size) }),
      }}>
      {/* Foto do token de fundo: nítida no topo e apagando para baixo, onde ficam os números. */}
      {tk.image && <>
        <div aria-hidden className="absolute inset-0 bg-cover bg-top" style={{ backgroundImage: `url(/api/assets/${tk.image})` }} />
        <div aria-hidden className="absolute inset-0 bg-linear-to-b from-transparent via-panel/85 via-45% to-panel" />
      </>}
      <div className={`relative space-y-2.5 p-3 ${tk.image ? 'pt-20' : ''}`}>
      <header className="flex items-center gap-2.5">
        {!tk.image && <Avatar name={tk.name} image={tk.image} pc={tk.pc} className="size-11" />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-xl leading-tight drop-shadow-[0_1px_2px_rgb(0_0_0/0.9)]">{tk.name}</p>
          <div className="mt-0.5 flex flex-wrap gap-1 empty:hidden">
            {c?.current && <span className="rounded-full bg-accent/15 px-2 py-px text-[10px] font-medium text-accent">{t('onTurn')}</span>}
            {c?.status && <span className={`rounded-full px-2 py-px text-[10px] font-medium ${STATUS[c.status] ?? 'bg-bg text-muted'}`}>{c.status}</span>}
          </div>
        </div>
      </header>

      {hp != null && (
        <div>
          <div className="flex items-end justify-between">
            <span className="flex items-center gap-1 text-[10px] font-medium tracking-wide text-muted uppercase"><Heart size={11} aria-hidden className="fill-fumble text-fumble" /> {t('hp')}</span>
            {hp <= 0
              ? <span className="flex items-center gap-1 text-sm font-medium text-fumble"><Skull size={14} aria-hidden /> {t('down')}</span>
              : <span className="tabular-nums"><span className={`font-serif text-2xl leading-none ${max ? HP_TEXT[hpColor(hp / max)] : ''}`}>{hp}</span>{max != null && <span className="text-xs text-muted"> / {max}</span>}</span>}
          </div>
          {!!max && <HpBar hp={hp} max={max} label={t('hp')} />}
        </div>
      )}

      {stats.length > 0 && (
        <dl className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
          {stats.map(({ label, icon: Icon, value }) => (
            <div key={label} className="flex flex-col-reverse items-center gap-1 rounded-lg border border-line/60 bg-bg/70 py-1.5">
              <dt className="flex items-center gap-1 text-[9px] font-medium tracking-wide text-muted uppercase"><Icon size={10} aria-hidden /> {label}</dt>
              <dd className={`font-serif text-lg leading-none tabular-nums ${value == null ? 'text-muted' : ''}`}>{value ?? '–'}</dd>
            </div>
          ))}
        </dl>
      )}

      {tk.conditions.length > 0 && (
        <section aria-label={tt('effects')} className="space-y-1.5 border-t border-line/60 pt-2">
          <h3 className="text-[10px] font-medium tracking-wide text-muted uppercase">{tt('effects')}</h3>
          <div className="grid grid-cols-2 gap-1">
            {tk.conditions.map((k) => { const { name, rounds } = effectOf(k); return <EffectChip key={k} name={name} rounds={rounds} className="min-w-0" /> })}
          </div>
        </section>
      )}
      </div>
    </div>
  )
}
