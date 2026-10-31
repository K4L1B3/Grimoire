'use client'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, FolderPlus, Grid3x3, ImagePlus, MoonStar, Pencil, Play, RotateCcw, Trash2 } from 'lucide-react'
import { request, useRealtime, useSocketEvent } from '@/components/realtime'
import { ask, askText } from '@/components/confirm'
import { upload } from '@/lib/upload'
import { createScene } from '../../../campaign-actions'
import { createFolder, deleteFolder, libraryList, moveItem, renameFolder, type Folder, type Item } from '../library-actions'
import type { SceneView } from './board-canvas'

const SCENE_MIME = 'application/x-grimorio-scene'

// Cenas do mestre (T1–T3): sessões sanfonadas guardam as cenas; preparar sem ninguém ver, ativar para todos, grid e modo masmorra.
// As sessões são as pastas de "Mapas" da biblioteca.
export function ScenePanel({ campaignId, current, onOpen, onError }: { campaignId: string; current: SceneView | null; onOpen: (id: string) => void; onError: (e: unknown) => void }) {
  const { socket } = useRealtime()
  const t = useTranslations('scenes')
  const [folders, setFolders] = useState<Folder[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [over, setOver] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const storage = `grimorio:sessoes:${campaignId}`
  const load = useCallback(() => libraryList(campaignId, 'maps').then((r) => { setFolders(r.folders); setItems(r.items) }).catch(onError), [campaignId, onError])
  useEffect(() => { load() }, [load, current?.id, current?.name, current?.active])
  useEffect(() => { try { setClosed(JSON.parse(localStorage.getItem(storage) ?? '{}')) } catch {} }, [storage])
  useSocketEvent('scene:activated', load)

  const toggle = (id: string) => setClosed((c) => {
    const next = { ...c, [id]: !c[id] }
    try { localStorage.setItem(storage, JSON.stringify(next)) } catch {}
    return next
  })
  const run = (fn: () => Promise<unknown>) => fn().then(load).catch(onError)
  const addMaps = async (files: File[], folderId: string | null) => {
    setBusy(true)
    try {
      let last: { id: string } | null = null
      for (const f of files.filter((x) => x.type.startsWith('image/'))) last = await createScene(campaignId, (await upload(campaignId, f, 'map')).id, f.name.replace(/\.[^.]+$/, ''), folderId)
      await load()
      if (last) onOpen(last.id)
    } catch (e) { onError(e) } finally { setBusy(false) }
  }

  const patch = (p: object) => current && request(socket, 'scene:update', { sceneId: current.id, patch: p }).then(load).catch(onError)
  const g = current?.grid
  // ponytail: subpastas criadas na biblioteca aparecem como sessões soltas; aninhar só se fizer falta aqui.
  const groups: { id: string | null; name: string }[] = [...folders.map((f) => ({ id: f.id, name: f.name })), ...(items.some((i) => !i.folderId || !folders.some((f) => f.id === i.folderId)) || !folders.length ? [{ id: null, name: t('noSession') }] : [])]

  return (
    <div className="text-sm" data-no-drop onDragOver={(e) => e.stopPropagation()} onDrop={(e) => e.stopPropagation()}>
      {current && g && (
        <>
          <div className="relative h-28 bg-raised bg-cover bg-center" style={current.image ? { backgroundImage: `url(/api/assets/${current.image})` } : undefined}>
            <div className="absolute inset-0 bg-linear-to-t from-panel via-panel/50 to-transparent" />
            <div className="absolute inset-x-3 bottom-2">
              <span className={`mb-1 inline-flex items-center gap-1.5 rounded-full bg-bg/80 px-2 py-0.5 text-xs ${current.active ? 'text-crit' : 'text-muted'}`}>
                <span className={`size-1.5 rounded-full ${current.active ? 'bg-crit' : 'bg-muted'}`} /> {t(current.active ? 'active' : 'preparing')}
              </span>
              <input aria-label={t('name')} key={current.id + current.name} defaultValue={current.name}
                className="w-full truncate rounded-md border border-transparent bg-transparent px-1 font-serif text-xl outline-none transition-colors hover:border-line focus:border-accent focus:bg-bg/80"
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                onBlur={(e) => e.target.value.trim() && e.target.value !== current.name && patch({ name: e.target.value })} />
            </div>
          </div>

          <div className="space-y-2 p-3">
            <div className={`rounded-lg border transition-colors ${current.dungeon ? 'border-accent/60 bg-accent/10' : 'border-line bg-bg/30'}`}>
              <label className="flex cursor-pointer items-center gap-3 p-3">
                <span className={`grid size-10 shrink-0 place-items-center rounded-lg transition-colors ${current.dungeon ? 'bg-accent/20 text-accent' : 'bg-raised text-muted'}`}><MoonStar size={20} aria-hidden /></span>
                <span className="min-w-0 flex-1"><span className="block font-medium">{t('dungeon')}</span><span className="block text-xs text-muted">{t('dungeonHint')}</span></span>
                <Switch on={current.dungeon} onChange={(dungeon) => patch({ dungeon })} />
              </label>
              {current.dungeon && (
                <div className="flex items-center justify-between gap-2 border-t border-accent/30 px-3 py-2 text-xs text-muted">
                  <span>{t('dungeonTools')}</span>
                  <button className="btn shrink-0 px-2 py-1 text-xs" onClick={async () => { if (await ask(t('resetFogConfirm'), t('resetFog'))) request(socket, 'fog:reset', { sceneId: current.id }).catch(onError) }}><RotateCcw size={12} /> {t('resetFog')}</button>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-line bg-bg/30">
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-raised text-muted"><Grid3x3 size={20} aria-hidden /></span>
                <span className="flex-1 font-medium">{t('showGrid')}</span>
                <Switch on={g.show} onChange={(show) => patch({ grid: { show } })} />
              </label>
              <details className="group/grid border-t border-line">
                <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink">
                  <ChevronRight size={12} className="transition-transform duration-200 group-open/grid:rotate-90" /> {t('gridMore')}
                </summary>
                <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                  <label><span className="label">{t('size')}</span><input className="input" type="number" min={8} defaultValue={g.size} key={`s${g.size}`} onBlur={(e) => patch({ grid: { size: Number(e.target.value) } })} /></label>
                  <label><span className="label">{t('unit')}</span><input className="input" type="number" step={0.5} min={0} defaultValue={g.unit} key={`u${g.unit}`} onBlur={(e) => patch({ grid: { unit: Number(e.target.value) } })} /></label>
                  <label><span className="label">{t('offsetX')}</span><input className="input" type="number" defaultValue={g.offsetX} key={`x${g.offsetX}`} onBlur={(e) => patch({ grid: { offsetX: Number(e.target.value) } })} /></label>
                  <label><span className="label">{t('offsetY')}</span><input className="input" type="number" defaultValue={g.offsetY} key={`y${g.offsetY}`} onBlur={(e) => patch({ grid: { offsetY: Number(e.target.value) } })} /></label>
                  <label><span className="label">{t('color')}</span><input type="color" className="h-9 w-full" defaultValue={g.color.slice(0, 7)} onBlur={(e) => patch({ grid: { color: `${e.target.value}55` } })} /></label>
                  <label><span className="label">{t('diagonal')}</span>
                    <select className="input" value={g.diagonal} onChange={(e) => patch({ grid: { diagonal: e.target.value } })}><option value="1:1">{t('diag11')}</option><option value="5-10-5">{t('diag5105')}</option></select>
                  </label>
                </div>
              </details>
            </div>
          </div>
        </>
      )}

      <div className="space-y-2 border-t border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-serif text-lg">{t('title')}</h2>
        <button className="btn px-2 py-1 text-xs" onClick={async () => { const n = await askText(t('sessionName')); if (n) run(() => createFolder(campaignId, 'maps', n, null)) }}><FolderPlus size={14} /> {t('newSession')}</button>
      </div>

      <div className="space-y-1.5">
        {groups.map(({ id, name }) => {
          const key = id ?? ''
          const rows = items.filter((i) => (id ? i.folderId === id : !i.folderId || !folders.some((f) => f.id === i.folderId)))
          const open = !closed[key]
          return (
            <section key={key} aria-label={name}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(key) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null) }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setOver(null)
                const scene = e.dataTransfer.getData(SCENE_MIME)
                if (scene) run(() => moveItem(campaignId, 'maps', scene, id))
                else addMaps([...e.dataTransfer.files], id)
              }}
              className={`group/session overflow-hidden rounded-lg border transition-colors ${over === key ? 'border-accent bg-accent/10' : 'border-line bg-bg/30'}`}>
              <header className="flex items-center gap-1 pr-2 hover:bg-raised/60">
                <button aria-expanded={open} onClick={() => toggle(key)} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-2 text-left font-medium">
                  <ChevronRight size={14} className={`shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
                  <span className="truncate">{name}</span>
                  <span className="text-xs font-normal text-muted">{rows.length}</span>
                </button>
                <label title={t('addMap')} className="cursor-pointer rounded p-1 text-muted transition-colors hover:text-ink">
                  <ImagePlus size={14} aria-hidden />
                  <input type="file" accept="image/*" multiple aria-label={`${t('addMap')}: ${name}`} className="sr-only" disabled={busy} onChange={(e) => { addMaps([...(e.target.files ?? [])], id); e.target.value = '' }} />
                </label>
                {id && (
                  <>
                    <button title={t('renameSession')} aria-label={t('renameSession')} className="rounded p-1 text-muted transition-colors hover:text-ink" onClick={async () => { const n = await askText(t('sessionName'), name); if (n) run(() => renameFolder(campaignId, id, n)) }}><Pencil size={14} /></button>
                    <button title={t('deleteSession')} aria-label={t('deleteSession')} className="rounded p-1 text-muted transition-colors hover:text-fumble" onClick={async () => { if (await ask(t('deleteSessionConfirm', { name }), t('deleteSession'))) run(() => deleteFolder(campaignId, id)) }}><Trash2 size={14} /></button>
                  </>
                )}
              </header>
              <div className={`grid transition-[grid-template-rows] duration-200 ease-(--ease-out-soft) ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <ul className="min-h-0 space-y-1 overflow-hidden px-1.5" inert={!open}>
                  {rows.map((r) => (
                    <li key={r.id} draggable onDragStart={(e) => e.dataTransfer.setData(SCENE_MIME, r.id)}
                      className={`first:mt-1 last:mb-1.5 flex cursor-grab items-center gap-2.5 rounded-md border p-1.5 transition-colors hover:bg-raised active:cursor-grabbing ${r.id === current?.id ? 'border-accent bg-accent/5' : 'border-line'}`}>
                      <span className="h-12 w-20 shrink-0 rounded bg-line bg-cover bg-center" style={r.image ? { backgroundImage: `url(/api/assets/${r.image})` } : undefined} />
                      <button className="min-w-0 flex-1 truncate text-left hover:text-accent" onClick={() => onOpen(r.id)} title={t('openHint')}>{r.name}</button>
                      {r.active
                        ? <span className="rounded-full bg-crit/15 px-2 py-0.5 text-xs text-crit">{t('active')}</span>
                        : <button className="btn px-1.5 py-0.5 text-xs" title={t('activateHint')} onClick={() => request(socket, 'scene:activate', { sceneId: r.id }).then(() => (onOpen(r.id), load())).catch(onError)}><Play size={12} /> {t('activate')}</button>}
                      <button className="text-muted hover:text-fumble" aria-label={t('delete', { name: r.name })} onClick={async () => { if (await ask(t('deleteConfirm', { name: r.name }), t('delete', { name: r.name }))) run(() => request(socket, 'scene:delete', { sceneId: r.id })) }}><Trash2 size={14} /></button>
                    </li>
                  ))}
                  {!rows.length && <li className="py-2 text-center text-xs text-muted">{t('emptySession')}</li>}
                </ul>
              </div>
            </section>
          )
        })}
      </div>
      </div>
    </div>
  )
}

// Checkbox de verdade por baixo: o <label> em volta dá o nome e o clique.
function Switch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <span className="relative h-6 w-11 shrink-0">
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} className="peer absolute inset-0 cursor-pointer opacity-0" />
      <span className="pointer-events-none absolute inset-0 rounded-full bg-line transition-colors duration-150 peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
      <span className="pointer-events-none absolute top-0.5 left-0.5 size-5 rounded-full bg-ink shadow transition-transform duration-150 ease-(--ease-out-soft) peer-checked:translate-x-5" />
    </span>
  )
}
