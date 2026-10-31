'use client'
import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText, ScrollText, Settings2, Upload } from 'lucide-react'
import { SheetView } from './sheet-view'
import { SoundBoard } from './sound-board'
import { PageView } from './wiki/page-view'
import { useRealtime, useSocketEvent } from './realtime'
import { useWindows, WindowLayer, type Win } from './windows'
import { upload } from '@/lib/upload'
import { createTemplate } from '@/app/campaign-actions'
import { importedSheets, libraryList, type Item } from '@/app/c/[id]/library-actions'
import { addSheet } from '@/app/c/[id]/sheets/actions'
import { TemplateEditor } from '@/app/c/[id]/sheets/t/[tid]/editor'
import { CombatWindow } from '@/app/c/[id]/play/combat-panel'

// Todas as janelas da campanha: o conteúdo de cada tipo, mais as que o servidor manda abrir (anexo ou nota mostrados pelo mestre).
export function CampaignWindows() {
  const { campaignId, me } = useRealtime()
  const { open } = useWindows()
  useSocketEvent<{ id: string; name: string; mime: string }>('handout', useCallback((a) => open({ kind: 'attachment', ref: a.id, title: a.name, extra: { mime: a.mime } }), [open]))
  useSocketEvent<{ id: string; title: string }>('page:shown', useCallback((p) => open({ kind: 'page', ref: p.id, title: p.title, w: 640, h: 620 }), [open]))
  const isGm = me.role === 'gm'
  return (
    <WindowLayer render={(w: Win) => {
      switch (w.kind) {
        case 'sheet': return <SheetView sheetId={w.ref} compact onEditFields={isGm ? (templateId, title) => open({ kind: 'editor', ref: templateId, title: `Campos · ${title}`, w: 900, h: 760, extra: { sheetId: w.ref } }) : undefined} />
        case 'sheets': return <SheetsWindow />
        case 'page': return <Suspense><PageView pageId={w.ref} /></Suspense>
        case 'attachment': return <Attachment id={w.ref} mime={w.extra?.mime ?? ''} />
        case 'combat': return <CombatWindow sceneId={w.ref} />
        case 'sound': return <SoundBoard />
        case 'editor': return <TemplateEditor campaignId={campaignId} templateId={w.ref} sheetId={w.extra?.sheetId} embedded />
      }
    }} />
  )
}

function Attachment({ id, mime }: { id: string; mime: string }) {
  const src = `/api/assets/${id}`
  return mime === 'application/pdf'
    ? <iframe src={src} title="Anexo" className="size-full bg-white" />
    : <div className="flex min-h-full items-center justify-center bg-black/40 p-2"><img src={src} alt="" className="max-h-full max-w-full object-contain" /></div>
}

// Janela "Fichas" (aberta pela barra lateral): o PDF de cada sistema é importado aqui e vira um molde com campos mapeados;
// personagens e criaturas abrem a própria ficha em outra janela, ou escolhem qual PDF usar.
function SheetsWindow() {
  const { campaignId, me } = useRealtime()
  const { open } = useWindows()
  const [groups, setGroups] = useState<{ title: string; items: Item[] }[]>([])
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isGm = me.role === 'gm'
  const load = useCallback(() => {
    const cats = isGm ? ([['characters', 'Personagens'], ['creatures', 'Criaturas']] as const) : ([['characters', 'Seus personagens']] as const)
    return Promise.all([Promise.all(cats.map(async ([c, title]) => ({ title, items: (await libraryList(campaignId, c)).items }))), importedSheets(campaignId)])
      .then(([g, t]) => { setGroups(g); setTemplates(t) }).catch((e) => setError(e.message))
  }, [campaignId, isGm])
  useEffect(() => { load() }, [load])
  // A biblioteca avisa quando cria personagem: a janela pode já estar aberta.
  useEffect(() => {
    window.addEventListener('grimorio:fichas', load)
    return () => window.removeEventListener('grimorio:fichas', load)
  }, [load])
  const editFields = (t: { id: string; name: string }) => open({ kind: 'editor', ref: t.id, title: `Campos · ${t.name}`, w: 900, h: 760 })
  const importPdf = async (file: File) => {
    setBusy(true)
    try {
      const a = await upload(campaignId, file, 'pdf')
      const name = file.name.replace(/\.pdf$/i, '')
      const t = await createTemplate(campaignId, a.id, name)
      await load()
      editFields({ id: t.id, name })
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const choose = async (a: Item, templateId: string) => {
    try {
      const s = await addSheet(campaignId, a.id, templateId, '')
      await load()
      open({ kind: 'sheet', ref: s.id, title: a.name })
    } catch (e) { setError((e as Error).message) }
  }
  return (
    <div className="space-y-4 p-3 text-sm">
      {error && <p role="alert" className="text-xs text-fumble">{error}</p>}
      {isGm && (
        <section aria-label="Fichas em PDF" className="space-y-2">
          <h3 className="label">Fichas em PDF</h3>
          <ul className="space-y-1">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded-lg border border-line bg-bg/50 p-1.5 pl-2">
                <FileText size={14} className="shrink-0 text-muted" aria-hidden /><span className="min-w-0 flex-1 truncate">{t.name}</span>
                <button className="btn px-2 py-0.5 text-xs" onClick={() => editFields(t)}>Editar campos</button>
              </li>
            ))}
          </ul>
          <label className={`btn w-full cursor-pointer ${busy ? 'opacity-50' : ''}`}>
            <Upload size={14} aria-hidden /> {busy ? 'Importando…' : 'Importar ficha em PDF'}
            <input type="file" accept="application/pdf" aria-label="Importar ficha em PDF" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importPdf(f) }} />
          </label>
          {!templates.length && <p className="text-xs text-muted">Importe o PDF da sua ficha e desenhe as caixas de texto sobre ele. Depois é só preencher.</p>}
        </section>
      )}
      {groups.map((g) => (
        <section key={g.title}>
          <h3 className="label">{g.title}</h3>
          <ul className="grid grid-cols-2 gap-2">
            {g.items.map((a) => (
              <li key={a.id}>
                {a.sheetId
                  ? <button onClick={() => open({ kind: 'sheet', ref: a.sheetId!, title: a.name })}
                      className="flex w-full items-center gap-2 rounded-lg border border-line bg-bg/50 p-2 text-left transition-all hover:-translate-y-px hover:border-accent hover:bg-raised">
                      <Portrait a={a} /><span className="truncate">{a.name}</span>
                    </button>
                  : <div className="flex items-center gap-2 rounded-lg border border-dashed border-line p-2">
                      <Portrait a={a} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{a.name}</span>
                        {templates.length
                          ? <select aria-label={`Escolher ficha de ${a.name}`} className="w-full rounded bg-bg text-xs" value="" onChange={(e) => e.target.value && choose(a, e.target.value)}>
                              <option value="">Escolher ficha…</option>
                              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          : <span className="block text-xs text-muted">Sem ficha</span>}
                      </span>
                    </div>}
              </li>
            ))}
            {!g.items.length && <li className="text-muted">Nenhum ainda.</li>}
          </ul>
        </section>
      ))}
      <Link href={`/c/${campaignId}/sheets`} className="btn w-full"><Settings2 size={14} /> Gerenciar fichas e moldes</Link>
    </div>
  )
}

function Portrait({ a }: { a: Item }) {
  return <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-line bg-cover bg-center" style={a.image ? { backgroundImage: `url(/api/assets/${a.image})` } : undefined}>{!a.image && <ScrollText size={16} className="text-muted" />}</span>
}
