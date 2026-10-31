import type { RollResult } from '@grimorio/core'

// Resultado detalhado (D4): fórmula, cada dado, descartados riscados, total em destaque, crítico e falha coloridos.
export function RollLine({ r, label }: { r: RollResult; label?: string | null }) {
  return (
    <div className="space-y-1">
      {label && <div className="text-xs font-medium text-ink">{label}</div>}
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-xs break-words text-muted">
          {r.formula} ·{' '}
          {r.terms.map((t, i) => (
            <span key={i}>
              {i > 0 && (t.sign < 0 ? ' − ' : ' + ')}
              {t.kind === 'dice' ? (
                <>[{t.dice.map((d, j) => (
                  <span key={j} className={`${d.dropped ? 'line-through opacity-50' : ''} ${d.success ? 'text-crit' : ''}`}>
                    {d.value}{d.exploded ? '!' : ''}{j < t.dice.length - 1 ? ', ' : ''}
                  </span>
                ))}]</>
              ) : t.kind === 'ref' ? <span title={`@${t.name}`}>{t.value}</span> : t.value}
            </span>
          ))}
        </span>
        <strong className={`text-xl tabular-nums ${r.crit ? 'text-crit' : r.fumble ? 'text-fumble' : 'text-accent'}`}>{r.total}</strong>
      </div>
    </div>
  )
}
