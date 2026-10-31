'use client'
// Caixas de confirmação e de texto no visual do app, no lugar de confirm() e prompt() do navegador.
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

type Ask = { message: string; ok?: string; danger?: boolean; input?: boolean; value?: string; resolve: (v: string | null) => void }
let show: ((a: Ask) => void) | null = null
const open = (a: Omit<Ask, 'resolve'>) => new Promise<string | null>((resolve) => { if (show) show({ ...a, resolve }); else resolve(null) })

export const ask = (message: string, ok?: string) => open({ message, ok, danger: true }).then((v) => v !== null)
export const askText = (message: string, value = '') => open({ message, input: true, value }).then((v) => v?.trim() || null)

export function DialogHost() {
  const t = useTranslations('dialog')
  const [a, setA] = useState<Ask | null>(null)
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { show = setA; return () => { show = null } }, [])
  useEffect(() => { if (a) ref.current?.showModal() }, [a])
  if (!a) return null
  const done = (v: string | null) => { a.resolve(v); setA(null) }
  return (
    <dialog ref={ref} onClose={() => done(null)} onClick={(e) => e.target === ref.current && done(null)}
      className="animate-pop m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-line bg-panel text-ink shadow-xl shadow-black/40 backdrop:bg-black/60">
      <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); done(a.input ? String(new FormData(e.currentTarget).get('value') ?? '') : '') }}>
        <p className="text-sm leading-relaxed">{a.message}</p>
        {a.input && <input name="value" autoFocus required aria-label={a.message} className="input" defaultValue={a.value} />}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => done(null)}>{t('cancel')}</button>
          <button className={a.danger ? 'btn border-fumble bg-fumble font-medium text-bg hover:border-fumble hover:bg-fumble hover:brightness-110' : 'btn btn-primary'}>{a.ok ?? t('ok')}</button>
        </div>
      </form>
    </dialog>
  )
}
