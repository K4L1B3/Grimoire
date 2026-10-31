'use client'
import { useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'
import { DynamicIcon } from 'lucide-react/dynamic'
import { X } from 'lucide-react'
import { EFFECTS, effectOf } from '@grimorio/core'

// Selo do efeito fora do tabuleiro: mesmo ícone e cor do token; condição fora da lista fica só com o texto.
export function EffectChip({ name, rounds, className = '', children }: { name: string; rounds?: number | string | null; className?: string; children?: ReactNode }) {
  const fx = effectOf(name).effect
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-line bg-bg py-0.5 pr-2 text-xs ${fx ? 'pl-0.5' : 'pl-2'} ${className}`} style={fx ? { borderColor: fx.color, backgroundColor: `${fx.color}33` } : undefined}>
      {fx && <span className="flex size-4 shrink-0 items-center justify-center rounded-full text-white" style={{ background: fx.color }}><DynamicIcon name={fx.icon} size={11} aria-hidden /></span>}
      <span className="truncate">{name}{rounds ? ` · ${rounds}r` : ''}</span>
      {children}
    </span>
  )
}

// Escolha de efeitos: cada clique liga ou desliga, e o selo aparece no tabuleiro na hora.
// No combate (`combat`) também aceita duração em rodadas e efeito digitado.
export function EffectsDialog({ name, active, combat, onToggle, onClose }: { name: string; active: string[]; combat?: boolean; onToggle: (name: string, rounds?: number) => void; onClose: () => void }) {
  const t = useTranslations('table')
  const [rounds, setRounds] = useState('')
  const on = new Set(active.map((c) => effectOf(c).effect?.name))
  const toggle = (effect: string) => onToggle(effect, Number(rounds) || undefined)
  return (
    <dialog ref={(d) => { if (d && !d.open) d.showModal() }} onClose={onClose} onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-label={t('effectsOf', { name })} className="card m-auto w-full max-w-md text-ink backdrop:bg-black/50">
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">{t('effectsOf', { name })}</h2>
          <button aria-label={t('closePanel')} onClick={onClose}><X size={16} /></button>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {EFFECTS.map((fx) => (
            <button key={fx.name} aria-pressed={on.has(fx.name)} onClick={() => toggle(fx.name)}
              className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-xs ${on.has(fx.name) ? 'border-accent text-accent' : 'border-transparent text-muted hover:bg-bg'}`}>
              <span className="flex size-8 items-center justify-center rounded-full text-white" style={{ background: fx.color }}><DynamicIcon name={fx.icon} size={18} /></span>
              {fx.name}
            </button>
          ))}
        </div>
        {combat && (
          <div className="flex items-center gap-2 border-t border-line pt-3 text-xs">
            <label className="flex shrink-0 items-center gap-1.5 text-muted" title={t('effectRoundsHint')}>
              {t('effectRounds')}
              <input type="number" min={1} max={999} value={rounds} onChange={(e) => setRounds(e.target.value)} className="input w-16 px-2 py-1" />
            </label>
            <form className="min-w-0 flex-1" onSubmit={(e) => {
              e.preventDefault()
              const custom = String(new FormData(e.currentTarget).get('effect')).trim()
              if (custom) toggle(custom)
              e.currentTarget.reset()
            }}>
              <input name="effect" maxLength={40} autoComplete="off" aria-label={t('effectCustom')} placeholder={t('effectCustom')} className="input w-full px-2 py-1" />
            </form>
          </div>
        )}
      </div>
    </dialog>
  )
}
