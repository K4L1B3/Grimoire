'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Dices, Download, Loader2, Minus, Plus, X } from 'lucide-react'
import { computeSheet, numeric, tabOrder, type Field } from '@grimorio/core'
import { request, useRealtime, useSocketEvent } from './realtime'
import { PdfPage, usePdf } from './pdf-view'
import { upload } from '@/lib/upload'
import { exportSheetPdf } from '@/lib/export-sheet'

type Loaded = { id: string; actorId: string | null; title: string; values: Record<string, unknown>; canEdit: boolean; refs: Record<string, number>; template: { id: string; name: string; pdfAssetId: string; fields: Field[] } }
type Row = Record<string, string | number | boolean | null>

// Tamanho do texto em cqw (largura da página): acompanha a altura do campo, sem passar de 11 pt numa página A4.
export const autoFont = (f: Field, aspect: number) => Math.min(f.h * aspect * 100 * 0.5, 1.85)

const FONTS = { sans: 'ui-sans-serif, system-ui, sans-serif', serif: 'Georgia, serif', mono: 'ui-monospace, monospace', hand: '"Comic Sans MS", "Segoe Print", cursive' }

// compact: dentro de uma janela flutuante; onEditFields: o mestre troca para o editor de campos desta ficha.
export function SheetView({ sheetId, compact = false, onEditFields }: { sheetId: string; compact?: boolean; onEditFields?: (templateId: string, title: string) => void }) {
  const [zoom, setZoom] = useState(1)
  const { socket, campaignId, me } = useRealtime()
  const [data, setData] = useState<Loaded | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [fields, setFields] = useState<Field[]>([])
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [exporting, setExporting] = useState(false)
  const focused = useRef<string | null>(null)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const edits = useRef(0)

  useEffect(() => {
    const join = () => request<Loaded>(socket, 'sheet:join', { sheetId }).then((d) => {
      setData(d)
      setValues(d.values)
      setFields(d.template.fields)
    }, (e) => setError(e.message))
    if (socket.connected) join()
    socket.on('connect', join)
    return () => {
      socket.off('connect', join)
      request(socket, 'sheet:leave', { sheetId }).catch(() => {})
    }
  }, [socket, sheetId])

  // Mudança de outra pessoa chega aqui; o campo que eu estou digitando não é sobrescrito.
  useSocketEvent<{ sheetId: string; name: string; value: unknown }>('sheet:changed', useCallback((m) => {
    if (m.sheetId === sheetId && focused.current !== m.name) setValues((v) => ({ ...v, [m.name]: m.value }))
  }, [sheetId]))
  useSocketEvent<{ templateId: string; fields: Field[] }>('template:changed', useCallback((m) => {
    setData((d) => (d && d.template.id === m.templateId ? (setFields(m.fields), d) : d))
  }, []))

  const set = (name: string, value: unknown, delay = 300) => {
    setValues((v) => ({ ...v, [name]: value }))
    setSaveState('saving')
    const edit = ++edits.current
    clearTimeout(timers.current.get(name))
    timers.current.set(name, setTimeout(() => request(socket, 'sheet:set', { sheetId, name, value }).then(() => {
      if (edit === edits.current) (setSaveState('saved'), setError(''))
    }, (e) => (setSaveState('idle'), setError(e.message))), delay))
  }

  // Campo que a ficha ainda não preencheu mostra o padrão do molde.
  const shown = useMemo(() => ({ ...Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.name, f.default])), ...values }), [fields, values])
  const computed = useMemo(() => computeSheet(fields, { ...numeric(shown), ...(data?.refs ?? {}) }), [fields, shown, data?.refs])
  const { doc, aspects, error: pdfError } = usePdf(data ? `/api/assets/${data.template.pdfAssetId}` : '')

  const rollField = (f: Field) =>
    request(socket, 'chat:send', { text: `/r ${f.roll} # ${data?.title} · ${f.name}`, actorId: data?.actorId }).catch((e) => setError(e.message))

  const back = !compact && <Link href={`/c/${campaignId}/sheets`} className="btn btn-ghost shrink-0 px-2 py-1 text-xs"><ArrowLeft size={14} aria-hidden /> Voltar</Link>
  if (error && !data) return <div className="space-y-3 p-8">{back}<p className="text-fumble">{error}</p></div>
  if (!data) return <p className="p-8 text-muted">Abrindo ficha…</p>

  const ordered = tabOrder(fields)
  const download = () => {
    setExporting(true)
    exportSheetPdf(`/api/assets/${data.template.pdfAssetId}`, fields, { ...values, ...computed.values }, data.title).catch((e) => setError(e.message)).finally(() => setExporting(false))
  }
  return (
    <div className={compact ? '' : 'min-h-full bg-bg'}>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-panel/95 px-3 py-2 backdrop-blur">
        {back}
        {/* Na janela o título já está na barra da janela. */}
        {compact ? <span className="mr-auto" /> : <h1 className="mr-auto truncate font-medium">{data.title}</h1>}
        {saveState !== 'idle' && (
          <span role="status" className="flex shrink-0 items-center gap-1 text-xs text-muted">
            {saveState === 'saving' ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Check size={12} className="text-crit" aria-hidden />}
            {saveState === 'saving' ? 'Salvando…' : 'Salvo'}
          </span>
        )}
        <span className="flex items-center rounded-lg border border-line text-xs">
          <button className="px-2 py-1 text-muted hover:text-ink" aria-label="Diminuir" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>−</button>
          <button className="px-1 py-1 tabular-nums text-muted hover:text-ink" title="Ajustar à largura" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button className="px-2 py-1 text-muted hover:text-ink" aria-label="Aumentar" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>+</button>
        </span>
        {onEditFields && <button className="btn px-2 py-1 text-xs" onClick={() => onEditFields(data.template.id, data.title)}>Editar campos</button>}
        {!onEditFields && me.role === 'gm' && <Link className="btn px-2 py-1 text-xs" href={`/c/${campaignId}/sheets/t/${data.template.id}`}>Editar campos</Link>}
        {error && <span role="alert" className="text-xs text-fumble">{error}</span>}
        <button className="btn px-2 py-1 text-xs" disabled={exporting} title="Baixar PDF preenchido" aria-label="Baixar PDF preenchido" onClick={download}>
          {exporting ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Download size={14} aria-hidden />}
          {!compact && (exporting ? 'Gerando…' : 'Baixar PDF')}
        </button>
      </div>
      {pdfError && <p className="p-4 text-fumble">Não consegui abrir o PDF: {pdfError}</p>}
      {!doc && !pdfError && <p className="p-8 text-center text-muted">Carregando PDF…</p>}
      <div className={`mx-auto space-y-6 ${compact ? 'p-2' : 'max-w-3xl p-4'}`} style={{ width: `${zoom * 100}%`, maxWidth: compact || zoom !== 1 ? 'none' : undefined }}>
        {doc && aspects.map((aspect, page) => (
          <PdfPage key={page} doc={doc} index={page} aspect={aspect} style={{ containerType: 'inline-size' }}>
            {ordered.filter((f) => f.page === page).map((f) => (
              <FieldInput key={f.id} f={f} aspect={aspect} value={f.formula ? computed.values[f.name] : shown[f.name]} error={computed.errors[f.name]}
                disabled={!data.canEdit} campaignId={campaignId}
                onFocus={() => (focused.current = f.name)} onBlur={() => (focused.current = null)}
                onChange={(v, delay) => set(f.name, v, delay)} onRoll={f.roll && data.canEdit ? () => rollField(f) : undefined} />
            ))}
          </PdfPage>
        ))}
      </div>
    </div>
  )
}

type InputProps = { f: Field; aspect: number; value: unknown; error?: string; disabled: boolean; campaignId: string; onFocus: () => void; onBlur: () => void; onChange: (v: unknown, delay?: number) => void; onRoll?: () => void }

function FieldInput({ f, aspect, value, error, disabled, campaignId, onFocus, onBlur, onChange, onRoll }: InputProps) {
  const style: React.CSSProperties = {
    left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`,
    fontFamily: FONTS[f.style?.font ?? 'sans'], fontSize: `${f.style?.size ? (f.style.size / 595) * 100 : autoFont(f, aspect)}cqw`,
    textAlign: f.style?.align ?? 'left', color: f.style?.color ?? '#111',
  }
  const base = 'absolute rounded-[2px] bg-sky-200/25 px-[0.3cqw] outline-none hover:bg-sky-200/40 focus:bg-sky-100/60 focus:ring-1 focus:ring-sky-600 disabled:bg-transparent'
  const label = f.name.replace(/_/g, ' ')
  const roll = onRoll && (
    <button type="button" tabIndex={-1} onClick={onRoll} title={`Rolar ${f.roll}`} aria-label={`Rolar ${label}`}
      className="absolute flex items-center justify-center rounded-full bg-accent text-bg shadow hover:brightness-110"
      style={{ left: `${(f.x + f.w) * 100}%`, top: `${(f.y + f.h / 2) * 100}%`, width: '2.6cqw', height: '2.6cqw', transform: 'translate(15%, -50%)' }}>
      <Dices style={{ width: '1.8cqw', height: '1.8cqw' }} />
    </button>
  )

  if (f.formula) {
    return (
      <>
        <output aria-label={label} title={error ?? f.formula} className={`absolute flex items-center px-[0.3cqw] ${error ? 'bg-fumble/30' : 'bg-emerald-200/25'}`}
          style={{ ...style, justifyContent: { left: 'flex-start', center: 'center', right: 'flex-end' }[f.style?.align ?? 'center'] }}>
          {error ? '!' : fmt(value)}
        </output>
        {roll}
      </>
    )
  }

  switch (f.type) {
    case 'checkbox':
      return <input type="checkbox" aria-label={label} disabled={disabled} checked={!!value} onChange={(e) => onChange(e.target.checked, 0)} className="absolute m-0 cursor-pointer accent-neutral-800" style={style} />
    case 'textarea':
      return <textarea aria-label={label} disabled={disabled} value={String(value ?? '')} onFocus={onFocus} onBlur={onBlur} onChange={(e) => onChange(e.target.value)} className={`${base} resize-none leading-tight`} style={style} />
    case 'counter': {
      const n = Number(value ?? 0) || 0
      return (
        <div className="absolute flex items-center" style={style}>
          {!disabled && <button type="button" tabIndex={-1} aria-label={`Diminuir ${label}`} onClick={() => onChange(n - 1, 150)} className="h-full px-[0.3cqw] text-neutral-600 hover:text-black"><Minus style={{ width: '1.4cqw' }} /></button>}
          <input aria-label={label} disabled={disabled} inputMode="numeric" value={String(value ?? '')} onFocus={onFocus} onBlur={onBlur} onChange={(e) => onChange(toNum(e.target.value))} className={`${base} relative! h-full min-w-0 flex-1 text-center`} />
          {!disabled && <button type="button" tabIndex={-1} aria-label={`Aumentar ${label}`} onClick={() => onChange(n + 1, 150)} className="h-full px-[0.3cqw] text-neutral-600 hover:text-black"><Plus style={{ width: '1.4cqw' }} /></button>}
          {roll}
        </div>
      )
    }
    case 'image':
      return (
        <label className={`absolute overflow-hidden bg-cover bg-center ${disabled ? '' : 'cursor-pointer hover:ring-1 hover:ring-sky-600'}`} aria-label={label} style={{ ...style, backgroundImage: value ? `url(/api/assets/${value})` : undefined, backgroundColor: value ? undefined : 'rgba(186,230,253,.25)' }}>
          {!disabled && <input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; if (file) onChange((await upload(campaignId, file, 'image')).id, 0) }} />}
        </label>
      )
    case 'list':
      return <ListField f={f} style={style} rows={Array.isArray(value) ? (value as Row[]) : []} disabled={disabled} onFocus={onFocus} onBlur={onBlur} onChange={onChange} />
    default:
      return (
        <>
          <input aria-label={label} disabled={disabled} inputMode={f.type === 'number' ? 'decimal' : undefined} value={String(value ?? '')} onFocus={onFocus} onBlur={onBlur}
            onChange={(e) => onChange(f.type === 'number' ? toNum(e.target.value) : e.target.value)} className={base} style={style} />
          {roll}
        </>
      )
  }
}

// Grupo repetível (F7): linhas com as colunas do molde; o jogador adiciona e remove.
function ListField({ f, style, rows, disabled, onFocus, onBlur, onChange }: { f: Field; style: React.CSSProperties; rows: Row[]; disabled: boolean; onFocus: () => void; onBlur: () => void; onChange: (v: unknown, delay?: number) => void }) {
  const cols = f.columns ?? []
  const rowPct = ((f.rowH ?? 0.022) / f.h) * 100
  const setCell = (i: number, col: string, v: string | number | boolean | null) => onChange(rows.map((r, j) => (j === i ? { ...r, [col]: v } : r)))
  return (
    <div className="absolute overflow-y-auto" style={style} role="group" aria-label={f.name}>
      {rows.map((r, i) => (
        <div key={i} className="group relative flex" style={{ height: `${rowPct}%` }}>
          {cols.map((c) => c.type === 'checkbox'
            ? <input key={c.name} type="checkbox" aria-label={`${c.name} ${i + 1}`} disabled={disabled} checked={!!r[c.name]} onChange={(e) => setCell(i, c.name, e.target.checked)} style={{ width: `${c.w * 100}%` }} />
            : <input key={c.name} aria-label={`${c.name} ${i + 1}`} disabled={disabled} value={String(r[c.name] ?? '')} onFocus={onFocus} onBlur={onBlur}
                onChange={(e) => setCell(i, c.name, c.type === 'number' ? toNum(e.target.value) : e.target.value)}
                className="h-full min-w-0 bg-sky-200/25 px-[0.3cqw] outline-none focus:bg-sky-100/60 disabled:bg-transparent" style={{ width: `${c.w * 100}%` }} />)}
          {!disabled && <button type="button" tabIndex={-1} aria-label={`Remover linha ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i), 0)} className="absolute top-0 -right-[2.2cqw] hidden h-full text-neutral-500 group-hover:block hover:text-red-600"><X style={{ width: '1.6cqw' }} /></button>}
        </div>
      ))}
      {!disabled && <button type="button" onClick={() => onChange([...rows, {}], 0)} className="text-neutral-500 hover:text-black" style={{ fontSize: '1.4cqw' }}>+ linha</button>}
    </div>
  )
}

const toNum = (s: string) => (s.trim() === '' || s === '-' ? s : Number.isFinite(Number(s.replace(',', '.'))) ? Number(s.replace(',', '.')) : s)
const fmt = (v: unknown) => (typeof v === 'number' ? (Number.isInteger(v) ? v : Math.round(v * 100) / 100) : '')
