'use client'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlignHorizontalJustifyStart, AlignVerticalJustifyStart, ArrowLeft, Copy, Dices, Redo2, ScanSearch, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { computeSheet, FIELD_TYPES, fieldMap, numeric, slugify, uniqueName, type Field, type FieldType } from '@grimorio/core'
import { request, useRealtime } from '@/components/realtime'
import { PdfPage, usePdf } from '@/components/pdf-view'
import { autoFont } from '@/components/sheet-view'
import { nearestLabel, pageTexts, pageWidgets } from '@/lib/pdf'

const TYPE_LABEL: Record<FieldType, string> = { text: 'Texto curto', textarea: 'Texto longo', number: 'Número', checkbox: 'Caixa de marcar', counter: 'Contador (+/−)', image: 'Imagem', list: 'Lista repetível' }
type Drag = { kind: 'draw' | 'move' | 'resize'; page: number; sx: number; sy: number; rect: DOMRect; orig: Field[]; id?: string }

// Com sheetId, o que se digita nas caixas vai para a ficha desse personagem; sem, vira o valor padrão do molde.
export function TemplateEditor({ campaignId, templateId, sheetId, embedded }: { campaignId: string; templateId: string; sheetId?: string; embedded?: boolean }) {
  const { socket } = useRealtime()
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [focusId, setFocusId] = useState<string | null>(null)
  const valueTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [tpl, setTpl] = useState<{ name: string; pdfAssetId: string } | null>(null)
  const [fields, setFields] = useState<Field[]>([])
  const [sel, setSel] = useState<string[]>([])
  const [status, setStatus] = useState<'saved' | 'saving' | 'dirty' | string>('saved')
  const [showMap, setShowMap] = useState(false)
  const [zoom, setZoom] = useState(1)
  const scroller = useRef<HTMLDivElement>(null)
  const pages = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null)
  const past = useRef<Field[][]>([])
  const future = useRef<Field[][]>([])
  const drag = useRef<Drag | null>(null)
  const texts = useRef(new Map<number, Awaited<ReturnType<typeof pageTexts>>>())
  const [draft, setDraft] = useState<{ page: number; x: number; y: number; w: number; h: number } | null>(null)
  // Refs com o valor atual, para os handlers de ponteiro (registrados no window) não lerem estado velho.
  const fieldsRef = useRef(fields)
  fieldsRef.current = fields
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    const join = () => request<{ name: string; pdfAssetId: string; fields: Field[] }>(socket, 'template:join', { templateId })
      .then((t) => { setTpl(t); setFields(t.fields) })
      .catch((e) => setStatus(e.message))
    if (socket.connected) join()
    socket.on('connect', join)
    return () => void socket.off('connect', join)
  }, [socket, templateId])

  const { doc, aspects, error } = usePdf(tpl ? `/api/assets/${tpl.pdfAssetId}` : '')

  useEffect(() => {
    if (!sheetId) return
    request<{ values: Record<string, unknown> }>(socket, 'sheet:join', { sheetId }).then((d) => setValues(d.values)).catch((e) => setStatus(e.message))
    const changed = (m: { sheetId: string; name: string; value: unknown }) => m.sheetId === sheetId && setValues((v) => ({ ...v, [m.name]: m.value }))
    socket.on('sheet:changed', changed)
    return () => void socket.off('sheet:changed', changed)
  }, [socket, sheetId])

  // Digitar dentro da caixa: na ficha (com sheetId) ou como padrão do molde. Não entra no Ctrl+Z dos campos.
  const valueOf = (f: Field) => (sheetId ? values[f.name] ?? f.default : f.default)
  const setValue = (f: Field, v: string | number | boolean) => {
    if (sheetId) {
      setValues((cur) => ({ ...cur, [f.name]: v }))
      clearTimeout(valueTimers.current.get(f.name))
      valueTimers.current.set(f.name, setTimeout(() => request(socket, 'sheet:set', { sheetId, name: f.name, value: v }).catch((e) => setStatus(e.message)), 300))
      return
    }
    const next = fieldsRef.current.map((x) => (x.id === f.id ? { ...x, default: v === '' ? undefined : v } : x))
    fieldsRef.current = next
    setFields(next)
    setStatus('dirty')
  }
  const computedValues = useMemo(() => {
    const base = Object.fromEntries(fields.map((f) => [f.name, valueOf(f)]).filter(([, v]) => v !== undefined))
    return computeSheet(fields, numeric(base)).values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, values, sheetId])

  // Toda mudança passa por aqui: guarda o passado para o Ctrl+Z e agenda o salvamento.
  const commit = useCallback((next: Field[], from?: Field[]) => {
    past.current.push(from ?? fieldsRef.current)
    if (past.current.length > 200) past.current.shift()
    future.current = []
    fieldsRef.current = next
    setFields(next)
    setStatus('dirty')
  }, [])

  useEffect(() => {
    if (status !== 'dirty') return
    const t = setTimeout(() => {
      setStatus('saving')
      request(socket, 'template:save', { templateId, fields }).then(() => setStatus('saved'), (e) => setStatus(e.message))
    }, 700)
    return () => clearTimeout(t)
  }, [status, fields, socket, templateId])

  const undo = () => { const p = past.current.pop(); if (p) (future.current.push(fields), setFields(p), setStatus('dirty')) }
  const redo = () => { const f = future.current.pop(); if (f) (past.current.push(fields), setFields(f), setStatus('dirty')) }
  const selected = fields.filter((f) => sel.includes(f.id))
  const one = selected.length === 1 ? selected[0]! : null
  const patch = (id: string, p: Partial<Field>) => commit(fields.map((f) => (f.id === id ? { ...f, ...p } : f)))

  const duplicate = () => {
    const names = fields.map((f) => f.name)
    const copies = selected.map((f) => {
      const name = uniqueName(f.name, names)
      names.push(name)
      return { ...f, id: crypto.randomUUID(), name, x: Math.min(f.x + 0.01, 1 - f.w), y: Math.min(f.y + f.h + 0.005, 1 - f.h) }
    })
    commit([...fields, ...copies])
    setSel(copies.map((c) => c.id))
  }
  const remove = () => { commit(fields.filter((f) => !sel.includes(f.id))); setSel([]) }
  const align = (key: 'x' | 'y' | 'w' | 'h') => {
    const ref = selected[0]!
    commit(fields.map((f) => (sel.includes(f.id) ? { ...f, [key]: ref[key] } : f)))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select')
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z' && !typing) (e.preventDefault(), e.shiftKey ? redo() : undo())
      else if (mod && e.key.toLowerCase() === 'y' && !typing) (e.preventDefault(), redo())
      else if (typing) return
      else if (mod && e.key.toLowerCase() === 'd' && sel.length) (e.preventDefault(), duplicate())
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) (e.preventDefault(), remove())
      else if (e.key === 'Escape') setSel([])
      else if (e.key.startsWith('Arrow') && sel.length) {
        e.preventDefault()
        const step = e.shiftKey ? 0.01 : 0.002
        const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]!
        commit(fields.map((f) => (sel.includes(f.id) ? { ...f, x: clamp(f.x + dx!, 0, 1 - f.w), y: clamp(f.y + dy!, 0, 1 - f.h) } : f)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Arrastar no vazio desenha; arrastar o campo move; arrastar o canto redimensiona.
  const startDrag = (e: React.PointerEvent, page: number, kind: Drag['kind'], id?: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const overlay = (e.currentTarget as HTMLElement).closest('[data-page]') as HTMLElement
    const rect = overlay.getBoundingClientRect()
    drag.current = { kind, page, sx: (e.clientX - rect.left) / rect.width, sy: (e.clientY - rect.top) / rect.height, rect, orig: fields, id }
    if (id && kind === 'move') setSel((s) => (e.shiftKey ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : s.includes(id) ? s : [id]))
    if (kind === 'draw' && !e.shiftKey) setSel([])
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  const onMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const x = clamp((e.clientX - d.rect.left) / d.rect.width, 0, 1), y = clamp((e.clientY - d.rect.top) / d.rect.height, 0, 1)
    if (d.kind === 'draw') return setDraft({ page: d.page, x: Math.min(x, d.sx), y: Math.min(y, d.sy), w: Math.abs(x - d.sx), h: Math.abs(y - d.sy) })
    const dx = x - d.sx, dy = y - d.sy
    setFields(d.orig.map((f) => {
      if (d.kind === 'resize') return f.id === d.id ? { ...f, w: clamp(f.w + dx, 0.01, 1 - f.x), h: clamp(f.h + dy, 0.006, 1 - f.y) } : f
      return selRef.current.includes(f.id) ? { ...f, x: clamp(f.x + dx, 0, 1 - f.w), y: clamp(f.y + dy, 0, 1 - f.h) } : f
    }))
  }
  const selRef = useRef(sel)
  selRef.current = sel

  const onUp = async () => {
    window.removeEventListener('pointermove', onMove)
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind !== 'draw') {
      const cur = fieldsRef.current
      if (JSON.stringify(cur) !== JSON.stringify(d.orig)) commit(cur, d.orig)
      return
    }
    const box = draftRef.current
    setDraft(null)
    if (box && box.w > 0.01 && box.h > 0.006) addField(box)
  }

  // Muda o zoom mantendo parado o ponto (x, y) da tela; sem ponto, o centro da área visível.
  const zoomAt = useCallback((next: (z: number) => number, x?: number, y?: number) => {
    const view = scroller.current!.getBoundingClientRect(), r = pages.current!.getBoundingClientRect()
    x ??= view.left + view.width / 2
    y ??= view.top + view.height / 2
    anchor.current = { x, y, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height }
    setZoom((z) => clamp(next(z), 0.5, 3))
  }, [])

  useLayoutEffect(() => {
    const a = anchor.current
    if (!a) return
    anchor.current = null
    const r = pages.current!.getBoundingClientRect()
    scroller.current!.scrollBy(r.left + a.fx * r.width - a.x, r.top + a.fy * r.height - a.y)
  }, [zoom])

  // Ctrl+roda ou pinça no trackpad. Listener nativo: o onWheel do React é passivo e não seguraria o zoom do navegador.
  useEffect(() => {
    const el = scroller.current!
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomAt((z) => z * Math.exp(-e.deltaY / 500), e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // Textos do PDF já carregados ao abrir, para a caixa nascer na hora (e aceitar digitação) com o nome sugerido.
  useEffect(() => {
    if (doc) aspects.forEach((_, i) => { if (!texts.current.has(i)) pageTexts(doc, i).then((t) => texts.current.set(i, t)) })
  }, [doc, aspects])

  const addField = (box: { page: number; x: number; y: number; w: number; h: number }) => {
    const label = nearestLabel(texts.current.get(box.page) ?? [], box)
    const cur = fieldsRef.current
    const f: Field = { id: crypto.randomUUID(), name: uniqueName(slugify(label) || 'campo', cur.map((c) => c.name)), type: box.h > 0.06 ? 'textarea' : 'text', ...box }
    commit([...cur, f])
    setSel([f.id])
    // Já dá para digitar na caixa recém-desenhada.
    setFocusId(f.id)
  }

  const detect = async () => {
    if (!doc) return
    const found = (await Promise.all(aspects.map((_, i) => pageWidgets(doc, i).then((ws) => ws.map((w) => ({ ...w, page: i })))))).flat()
    const names = fields.map((f) => f.name)
    const added: Field[] = found.map((w) => {
      const name = uniqueName(slugify(w.label) || 'campo', names)
      names.push(name)
      return { id: crypto.randomUUID(), name, type: w.type, page: w.page, x: w.x, y: w.y, w: w.w, h: w.h }
    })
    if (!added.length) return setStatus('Esse PDF não tem campos de formulário')
    commit([...fields, ...added])
  }

  const analysis = useMemo(() => {
    const { dependents, syntax } = fieldMap(fields)
    const zeros = Object.fromEntries(fields.filter((f) => !f.formula).map((f) => [f.name, 0]))
    const { errors } = computeSheet(fields, zeros)
    return { dependents, errors: { ...errors, ...syntax } }
  }, [fields])

  if (error) return <p className="p-8 text-fumble">Não consegui abrir o PDF: {error}</p>

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col bg-bg">
        <div className="flex flex-wrap items-center gap-1 border-b border-line bg-panel px-3 py-2">
          {!embedded && <Link href={`/c/${campaignId}/sheets`} className="btn btn-ghost p-1.5" aria-label="Voltar"><ArrowLeft size={16} /></Link>}
          <input aria-label="Nome do molde" defaultValue={tpl?.name} key={tpl?.name} className="w-48 bg-transparent font-medium outline-none focus:text-accent"
            onBlur={(e) => tpl && e.target.value.trim() && e.target.value !== tpl.name && request(socket, 'template:save', { templateId, fields, name: e.target.value })} />
          <span className="mx-2 h-5 w-px bg-line" />
          <button className="btn btn-ghost p-1.5" onClick={undo} aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)"><Undo2 size={16} /></button>
          <button className="btn btn-ghost p-1.5" onClick={redo} aria-label="Refazer" title="Refazer (Ctrl+Shift+Z)"><Redo2 size={16} /></button>
          <button className="btn btn-ghost p-1.5" disabled={!sel.length} onClick={duplicate} aria-label="Duplicar (Ctrl+D)" title="Duplicar (Ctrl+D)"><Copy size={16} /></button>
          <button className="btn btn-ghost p-1.5" disabled={!sel.length} onClick={remove} aria-label="Apagar (Del)" title="Apagar (Del)"><Trash2 size={16} /></button>
          <button className="btn btn-ghost p-1.5" disabled={sel.length < 2} onClick={() => align('x')} aria-label="Alinhar à esquerda" title="Alinhar à esquerda"><AlignHorizontalJustifyStart size={16} /></button>
          <button className="btn btn-ghost p-1.5" disabled={sel.length < 2} onClick={() => align('y')} aria-label="Alinhar no topo" title="Alinhar no topo"><AlignVerticalJustifyStart size={16} /></button>
          <button className="btn btn-ghost px-2 py-1 text-xs" disabled={sel.length < 2} onClick={() => (align('w'), align('h'))} title="Mesmo tamanho do primeiro">= tamanho</button>
          <span className="mx-2 h-5 w-px bg-line" />
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={detect} title="Importar campos de formulário que o PDF já tem"><ScanSearch size={14} /> Detectar campos</button>
          <button className={`btn btn-ghost px-2 py-1 text-xs ${showMap ? 'text-accent' : ''}`} onClick={() => setShowMap(!showMap)}>Mapa de campos</button>
          <span className="mx-2 h-5 w-px bg-line" />
          <button className="btn btn-ghost p-1.5" onClick={() => zoomAt((z) => z - 0.25)} aria-label="Reduzir" title="Reduzir (Ctrl+roda do mouse)"><ZoomOut size={16} /></button>
          <button className="btn btn-ghost w-12 justify-center px-1 py-1 text-xs tabular-nums" onClick={() => zoomAt(() => 1)} aria-label="Voltar a 100%" title="Voltar a 100%">{Math.round(zoom * 100)}%</button>
          <button className="btn btn-ghost p-1.5" onClick={() => zoomAt((z) => z + 0.25)} aria-label="Ampliar" title="Ampliar (Ctrl+roda do mouse)"><ZoomIn size={16} /></button>
          <span role="status" className={`ml-auto text-xs ${['saved', 'saving', 'dirty'].includes(status) ? 'text-muted' : 'text-fumble'}`}>
            {status === 'saved' ? 'Salvo' : status === 'saving' || status === 'dirty' ? 'Salvando…' : status}
          </span>
        </div>
        <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
          <p className="px-4 pt-3 text-center text-xs text-muted">Arraste sobre o PDF para criar um campo e já digite nele{sheetId ? ' (vai para esta ficha)' : ' (vira o valor padrão das fichas novas)'}. Arraste pela borda para mover; Shift+clique seleciona vários.</p>
          <div ref={pages} className="mx-auto space-y-6 p-4" style={{ width: `calc(min(100%, 48rem) * ${zoom})` }}>
            {doc && aspects.map((aspect, page) => (
              <PdfPage key={page} doc={doc} index={page} aspect={aspect} data-page={page} style={{ containerType: 'inline-size' }} className="absolute inset-0 cursor-crosshair touch-none"
                onPointerDown={(e) => startDrag(e, page, 'draw')}>
                {fields.filter((f) => f.page === page).map((f) => (
                  <div key={f.id} onPointerDown={(e) => startDrag(e, page, 'move', f.id)}
                    className={`absolute cursor-move border-2 p-[2px] ${sel.includes(f.id) ? 'border-accent bg-accent/20' : analysis.errors[f.name] ? 'border-fumble bg-fumble/15' : f.formula ? 'border-crit bg-crit/15' : 'border-sky-500 bg-sky-500/15'}`}
                    style={{ left: pct(f.x), top: pct(f.y), width: pct(f.w), height: pct(f.h) }}>
                    <span className="pointer-events-none absolute -top-4 left-0 rounded-sm bg-bg/80 px-1 text-[10px] leading-4 whitespace-nowrap text-ink">{f.name}{f.roll && ' 🎲'}</span>
                    <InlineValue f={f} aspect={aspect} value={f.formula ? computedValues[f.name] : valueOf(f)} autoFocus={focusId === f.id}
                      onFocus={() => { setSel([f.id]); setFocusId(null) }} onChange={(v) => setValue(f, v)} />
                    {sel.includes(f.id) && <span onPointerDown={(e) => startDrag(e, page, 'resize', f.id)} className="absolute -right-1 -bottom-1 size-2.5 cursor-se-resize bg-accent" />}
                  </div>
                ))}
                {draft?.page === page && <div className="absolute border border-dashed border-accent" style={{ left: pct(draft.x), top: pct(draft.y), width: pct(draft.w), height: pct(draft.h) }} />}
              </PdfPage>
            ))}
          </div>
        </div>
      </div>

      <aside className="w-80 shrink-0 overflow-y-auto border-l border-line bg-panel p-3 text-sm">
        {showMap ? <FieldMap fields={fields} analysis={analysis} onPick={(id) => setSel([id])} /> : one ? (
          <FieldPanel key={one.id} field={one} names={fields.map((f) => f.name)} error={analysis.errors[one.name]} usedBy={analysis.dependents.get(one.name) ?? []} onChange={(p) => patch(one.id, p)} />
        ) : (
          <p className="text-muted">{sel.length > 1 ? `${sel.length} campos selecionados.` : 'Selecione um campo para editar nome, tipo, fórmula e estilo.'}</p>
        )}
      </aside>
    </div>
  )
}

function FieldPanel({ field: f, names, error, usedBy, onChange }: { field: Field; names: string[]; error?: string; usedBy: string[]; onChange: (p: Partial<Field>) => void }) {
  const [name, setName] = useState(f.name)
  const nameErr = !/^[a-z_][a-z0-9_]*$/.test(name) ? 'Use minúsculas, números e _' : name !== f.name && names.includes(name) ? 'Já existe um campo com esse nome' : ''
  const numeric = f.type === 'number' || f.type === 'counter'
  return (
    <div className="space-y-4">
      <label className="block"><span className="label">Nome</span>
        <input aria-label="Nome do campo" className="input font-mono" value={name} onChange={(e) => setName(slugify(e.target.value) || e.target.value)} onBlur={() => !nameErr && name !== f.name && onChange({ name })} />
        {nameErr && <span className="text-xs text-fumble">{nameErr}</span>}
        <span className="mt-1 block text-xs text-muted">Use como <code>@{f.name}</code> em fórmulas, rolagens e barras do token.</span>
      </label>
      <label className="block"><span className="label">Tipo</span>
        <select className="input" value={f.type} onChange={(e) => onChange({ type: e.target.value as FieldType, ...(e.target.value === 'list' && !f.columns ? { columns: [{ name: 'item', type: 'text', w: 0.7 }, { name: 'qtd', type: 'number', w: 0.3 }], rowH: 0.022 } : {}) })}>
          {FIELD_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
      </label>
      {numeric && (
        <label className="block"><span className="label">Fórmula (opcional)</span>
          <FormulaInput value={f.formula ?? ''} names={names.filter((n) => n !== f.name)} placeholder="floor((forca-10)/2)" onCommit={(v) => onChange({ formula: v || undefined })} />
          {error && <span className="text-xs text-fumble">{error}</span>}
          <span className="mt-1 block text-xs text-muted">Com fórmula o campo fica só leitura.</span>
        </label>
      )}
      <label className="block"><span className="label"><Dices size={12} className="inline" /> Rolagem (opcional)</span>
        <FormulaInput value={f.roll ?? ''} names={names} placeholder="1d20 + @mod_forca" onCommit={(v) => onChange({ roll: v || undefined })} />
      </label>
      {f.type === 'list' && <ColumnsEditor field={f} onChange={onChange} />}
      {f.type !== 'checkbox' && f.type !== 'image' && (
        <fieldset className="space-y-2"><legend className="label">Estilo</legend>
          <div className="grid grid-cols-2 gap-2">
            <select className="input" aria-label="Fonte" value={f.style?.font ?? 'sans'} onChange={(e) => onChange({ style: { ...f.style, font: e.target.value as 'sans' } })}>
              <option value="sans">Sem serifa</option><option value="serif">Serifa</option><option value="mono">Mono</option><option value="hand">Manuscrita</option>
            </select>
            <select className="input" aria-label="Alinhamento" value={f.style?.align ?? 'left'} onChange={(e) => onChange({ style: { ...f.style, align: e.target.value as 'left' } })}>
              <option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option>
            </select>
            <input className="input" type="number" min={4} max={96} aria-label="Tamanho da fonte" placeholder="Auto" value={f.style?.size ?? ''} onChange={(e) => onChange({ style: { ...f.style, size: e.target.value ? Number(e.target.value) : null } })} />
            <input type="color" aria-label="Cor" className="h-9 w-full" value={f.style?.color ?? '#111111'} onChange={(e) => onChange({ style: { ...f.style, color: e.target.value } })} />
          </div>
        </fieldset>
      )}
      {usedBy.length > 0 && <p className="text-xs text-muted">Usado por: {usedBy.map((n) => <code key={n} className="mr-1">{n}</code>)}</p>}
    </div>
  )
}

// Fórmula com autocompletar dos nomes de campo (SDD "Ficha": escreve com os nomes e um autocompletar).
function FormulaInput({ value, names, placeholder, onCommit }: { value: string; names: string[]; placeholder: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value)
  const word = /@?([a-z_][\w.]*)$/i.exec(v)?.[1] ?? ''
  const hints = word ? names.filter((n) => n.startsWith(word) && n !== word).slice(0, 6) : []
  return (
    <div>
      <input className="input font-mono" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v.trim())}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur())} />
      {hints.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {hints.map((n) => <button key={n} type="button" className="rounded bg-bg px-1.5 font-mono text-xs hover:text-accent" onMouseDown={(e) => { e.preventDefault(); setV(v.slice(0, v.length - word.length) + n) }}>{n}</button>)}
        </div>
      )}
    </div>
  )
}

function ColumnsEditor({ field: f, onChange }: { field: Field; onChange: (p: Partial<Field>) => void }) {
  const cols = f.columns ?? []
  const set = (i: number, p: Partial<(typeof cols)[number]>) => onChange({ columns: cols.map((c, j) => (j === i ? { ...c, ...p } : c)) })
  return (
    <fieldset className="space-y-2"><legend className="label">Colunas da lista</legend>
      {cols.map((c, i) => (
        <div key={i} className="flex gap-1">
          <input className="input px-2 py-1 font-mono text-xs" value={c.name} aria-label="Nome da coluna" onChange={(e) => set(i, { name: slugify(e.target.value) || 'col' })} />
          <select className="input w-24 px-1 py-1 text-xs" value={c.type} aria-label="Tipo da coluna" onChange={(e) => set(i, { type: e.target.value as 'text' })}><option value="text">Texto</option><option value="number">Número</option><option value="checkbox">Marcar</option></select>
          <input className="input w-16 px-1 py-1 text-xs" type="number" min={5} max={100} aria-label="Largura %" value={Math.round(c.w * 100)} onChange={(e) => set(i, { w: Number(e.target.value) / 100 })} />
          <button type="button" className="text-muted hover:text-fumble" aria-label="Remover coluna" onClick={() => onChange({ columns: cols.filter((_, j) => j !== i) })}><Trash2 size={12} /></button>
        </div>
      ))}
      <button type="button" className="btn px-2 py-1 text-xs" onClick={() => onChange({ columns: [...cols, { name: `col${cols.length + 1}`, type: 'text', w: 0.2 }] })}>+ coluna</button>
      <label className="flex items-center gap-2 text-xs">Altura da linha
        <input className="input w-20 px-1 py-1 text-xs" type="number" step={0.1} min={0.5} max={20} value={((f.rowH ?? 0.022) * 100).toFixed(1)} onChange={(e) => onChange({ rowH: Number(e.target.value) / 100 })} />% da página
      </label>
    </fieldset>
  )
}

function FieldMap({ fields, analysis, onPick }: { fields: Field[]; analysis: { dependents: Map<string, string[]>; errors: Record<string, string> }; onPick: (id: string) => void }) {
  return (
    <div className="space-y-2">
      <h2 className="font-medium">Mapa de campos</h2>
      <p className="text-xs text-muted">Esses nomes são o que o token, o chat e o combate usam com @.</p>
      <table className="w-full text-xs">
        <thead className="text-left text-muted"><tr><th className="py-1">Campo</th><th>Fórmula</th><th>Usado por</th></tr></thead>
        <tbody>
          {[...fields].sort((a, b) => a.name.localeCompare(b.name)).map((f) => (
            <tr key={f.id} className="cursor-pointer border-t border-line align-top hover:bg-bg" onClick={() => onPick(f.id)}>
              <td className="py-1 font-mono">{f.name}</td>
              <td className="font-mono break-all">{f.formula}{analysis.errors[f.name] && <div className="text-fumble">{analysis.errors[f.name]}</div>}</td>
              <td className="font-mono">{analysis.dependents.get(f.name)?.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const pct = (v: number) => `${v * 100}%`

// Valor digitado direto na caixa do campo (texto, número, contador, caixa de marcar); fórmula só mostra o resultado.
function InlineValue({ f, aspect, value, autoFocus, onFocus, onChange }: { f: Field; aspect: number; value: unknown; autoFocus: boolean; onFocus: () => void; onChange: (v: string | number | boolean) => void }) {
  const stop = (e: React.PointerEvent) => e.stopPropagation()
  const font = { fontSize: `${f.style?.size ? (f.style.size / 595) * 100 : autoFont(f, aspect)}cqw`, textAlign: f.style?.align ?? 'left' } as const
  const cls = 'size-full min-w-0 resize-none bg-white/40 px-[0.3cqw] leading-tight text-black outline-none focus:bg-white/80'
  if (f.formula) return <output className="flex size-full items-center justify-center text-black/80" style={font}>{typeof value === 'number' ? Math.round(value * 100) / 100 : ''}</output>
  if (f.type === 'checkbox') return <input type="checkbox" aria-label={f.name} checked={!!value} onPointerDown={stop} onFocus={onFocus} onChange={(e) => onChange(e.target.checked)} className="size-full cursor-pointer" />
  if (f.type === 'image' || f.type === 'list') return null
  const num = f.type === 'number' || f.type === 'counter'
  const props = {
    'aria-label': f.name, autoFocus, value: String(value ?? ''), onPointerDown: stop, onFocus, style: font, className: cls,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(num && e.target.value.trim() !== '' && Number.isFinite(Number(e.target.value.replace(',', '.'))) ? Number(e.target.value.replace(',', '.')) : e.target.value),
  }
  return f.type === 'textarea' ? <textarea {...props} /> : <input {...props} inputMode={num ? 'decimal' : undefined} />
}
