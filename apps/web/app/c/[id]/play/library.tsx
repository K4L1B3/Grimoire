'use client'
// Barra da biblioteca embaixo do mapa (estilo Owlbear): Mapas, Objetos, Personagens, Criaturas, Anexos e Notas.
// Cada categoria abre um painel com pastas; os itens são arrastados para o mapa.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookmarkX, ChevronRight, Eye, EyeOff, FileText, Folder, FolderInput, FolderPlus, Image as ImageIcon, LockOpen, Map, Paperclip, Pencil, Play, Plus, ScrollText, Search, Skull, Trash2, Upload, Users, X } from 'lucide-react'
import { request, useRealtime } from '@/components/realtime'
import { useWindows } from '@/components/windows'
import { ask, askText } from '@/components/confirm'
import { useWiki } from '@/components/wiki/context'
import { pointerDrag } from '@/lib/pointer-drag'
import { upload } from '@/lib/upload'
import { createScene } from '../../../campaign-actions'
import { createActor, deleteActor, updateActor } from '../sheets/actions'
import { addLibraryAsset, createFolder, deleteFolder, libraryList, moveFolder, moveItem, removeLibraryAsset, renameFolder, renameItem, type Category, type Folder as FolderT, type Item } from '../library-actions'

type Cat = Category
export type LibraryDrag = { category: Cat; id: string; name: string; image: string | null; pc?: boolean; mime?: string }
export type DropPoint = Pick<PointerEvent, 'clientX' | 'clientY' | 'altKey'>
type Spot = { folder: string | null } | 'map' | null

// O alvo mais próximo vence, então painel por cima do mapa (data-no-drop) não solta nele. Pasta vazia ("") é a raiz.
function spotAt(x: number, y: number): Spot {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-folder],[data-no-drop],[data-map-drop]')
  if (!el) return null
  if (el.dataset.dropFolder !== undefined) return { folder: el.dataset.dropFolder || null }
  return el.dataset.mapDrop !== undefined ? 'map' : null
}

const CATS: { id: Cat; label: string; icon: typeof Map; gm?: boolean }[] = [
  { id: 'maps', label: 'Mapas', icon: Map, gm: true },
  { id: 'props', label: 'Objetos', icon: ImageIcon, gm: true },
  { id: 'characters', label: 'Personagens', icon: Users },
  { id: 'creatures', label: 'Criaturas', icon: Skull, gm: true },
  { id: 'attachments', label: 'Anexos', icon: Paperclip, gm: true },
  { id: 'notes', label: 'Notas', icon: FileText },
]

export function LibraryBar({ onOpenScene, onDropItem, onError }: { onOpenScene: (id: string) => void; onDropItem: (item: LibraryDrag, at: DropPoint) => void; onError: (e: unknown) => void }) {
  const { me } = useRealtime()
  const [cat, setCat] = useState<Cat | null>(null)
  const isGm = me.role === 'gm'
  // Jogador: os próprios personagens e as notas; observador: só notas.
  const cats = CATS.filter((c) => (!c.gm || isGm) && (me.role !== 'observer' || c.id === 'notes'))
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex flex-col items-center gap-2 px-3">
      {cat && <LibraryPanel key={cat} cat={cat} onClose={() => setCat(null)} onOpenScene={onOpenScene} onDropItem={onDropItem} onError={onError} />}
      <div role="toolbar" aria-label="Biblioteca" className="pointer-events-auto flex gap-1 rounded-2xl border border-line bg-panel/95 p-1.5 shadow-xl shadow-black/30 backdrop-blur">
        {cats.map(({ id, label, icon: Icon }) => (
          <button key={id} aria-pressed={cat === id} onClick={() => setCat(cat === id ? null : id)}
            className={`flex w-[4.75rem] flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[11px] font-medium transition-all duration-150 active:scale-95 ${cat === id ? 'bg-accent text-bg shadow' : 'text-muted hover:-translate-y-0.5 hover:bg-raised hover:text-ink'}`}>
            <Icon size={18} aria-hidden /> {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function LibraryPanel({ cat, onClose, onOpenScene, onDropItem, onError }: { cat: Cat; onClose: () => void; onOpenScene: (id: string) => void; onDropItem: (item: LibraryDrag, at: DropPoint) => void; onError: (e: unknown) => void }) {
  const { socket, campaignId, me } = useRealtime()
  const { open } = useWindows()
  const wiki = useWiki()
  const isGm = me.role === 'gm'
  const [data, setData] = useState<{ folders: FolderT[]; items: Item[] }>({ folders: [], items: [] })
  const [folder, setFolder] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [moving, setMoving] = useState<Item | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const portrait = useRef<HTMLInputElement>(null)
  const portraitOf = useRef<string | null>(null)
  const label = CATS.find((c) => c.id === cat)!.label

  const load = useCallback(() => {
    libraryList(campaignId, cat).then(setData).catch(onError)
  }, [campaignId, cat, onError])
  useEffect(load, [load])

  // As notas e as pastas da mesa vêm da árvore ao vivo da wiki, iguais para todos; a pasta pessoal só guarda onde cada um pôs a nota.
  const folders: (FolderT & { shared?: boolean })[] = useMemo(() => (cat !== 'notes' ? data.folders
    : [...wiki.noteFolders.map((f) => ({ id: f.page.id, parentId: f.parentId, name: f.page.title, shared: true })), ...data.folders]), [cat, data.folders, wiki.noteFolders])
  const isShared = (id?: string | null) => !!id && !!folders.find((f) => f.id === id)?.shared
  const items: Item[] = useMemo(() => {
    if (cat !== 'notes') return data.items
    const placed = new globalThis.Map(data.items.map((i) => [i.id, i.folderId]))
    return wiki.notes.map(({ page: p, folderId }) => ({ id: p.id, name: p.title, folderId: folderId ?? placed.get(p.id) ?? null, image: null }))
  }, [cat, data.items, wiki.notes])
  // A pasta aberta pode sumir na mão do mestre enquanto o jogador está dentro dela.
  useEffect(() => { if (folder && !folders.some((f) => f.id === folder)) setFolder(null) }, [folder, folders])
  const search = q.trim().toLowerCase()
  const shownFolders = search ? [] : folders.filter((f) => f.parentId === folder)
  const shownItems = items.filter((i) => (search ? i.name.toLowerCase().includes(search) : (i.folderId ?? null) === folder))
  const trail = useMemo(() => {
    const out: FolderT[] = []
    for (let f = folders.find((x) => x.id === folder); f; f = folders.find((x) => x.id === f!.parentId)) out.unshift(f)
    return out
  }, [folders, folder])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn(); load() } catch (e) { onError(e) } finally { setBusy(false) }
  }

  const onFiles = (files: FileList | null) => files && run(async () => {
    for (const f of [...files]) {
      const base = f.name.replace(/\.[^.]+$/, '')
      if (cat === 'maps') await createScene(campaignId, (await upload(campaignId, f, 'map')).id, base, folder)
      else if (cat === 'props' || cat === 'attachments') {
        const kind = f.type === 'application/pdf' ? 'pdf' : 'image'
        if (cat === 'props' && kind === 'pdf') throw new Error('Objeto precisa ser imagem')
        await addLibraryAsset(campaignId, (await upload(campaignId, f, kind)).id, cat, folder)
      }
    }
  })

  const openSheets = () => {
    open({ kind: 'sheets', ref: 'all', title: 'Fichas', w: 460, h: 560, x: 84, y: 60 })
    window.dispatchEvent(new Event('grimorio:fichas'))
  }
  const create = async () => {
    if (cat === 'characters' || cat === 'creatures') {
      const name = await askText(cat === 'characters' ? 'Nome do personagem' : 'Nome da criatura')
      if (name) run(async () => {
        const r = await createActor(campaignId, { name, kind: cat === 'characters' ? 'character' : 'creature', folderId: folder })
        if (r.sheetId) open({ kind: 'sheet', ref: r.sheetId, title: name })
        else openSheets()
      })
    } else if (cat === 'notes') {
      const title = await askText('Título da nota')
      if (title) run(async () => {
        const r = await request<{ id: string }>(socket, 'page:create', { title, kind: 'text', inNotes: true, parentId: isShared(folder) ? folder : null })
        if (folder && !isShared(folder)) await moveItem(campaignId, cat, r.id, folder)
        open({ kind: 'page', ref: r.id, title, w: 640, h: 620 })
      })
    } else fileInput.current?.click()
  }

  const openItem = (i: Item) => {
    if (cat === 'maps') return onOpenScene(i.id)
    if ((cat === 'characters' || cat === 'creatures') && i.sheetId) return open({ kind: 'sheet', ref: i.sheetId, title: i.name })
    if (cat === 'characters' || cat === 'creatures') return openSheets()
    if (cat === 'attachments' || cat === 'props') return open({ kind: 'attachment', ref: i.id, title: i.name, extra: { mime: i.mime ?? '' } })
    if (cat === 'notes') return open({ kind: 'page', ref: i.id, title: i.name, w: 640, h: 620 })
  }

  const removeItem = async (i: Item) => {
    if (!(await ask(`Apagar "${i.name}"?`, 'Apagar'))) return
    run(async () => {
      if (cat === 'maps') await request(socket, 'scene:delete', { sceneId: i.id })
      else if (cat === 'props' || cat === 'attachments') await removeLibraryAsset(campaignId, i.id)
      else if (cat === 'characters' || cat === 'creatures') await deleteActor(campaignId, i.id)
      else await request(socket, 'page:delete', { id: i.id })
    })
  }

  // Mexer em pasta da mesa é mexer na árvore da wiki, e todos veem na hora. Na raiz, só continua em Notas se estiver indicada.
  const moveShared = async (id: string, parentId: string | null) => {
    if (!parentId) await request(socket, 'page:update', { id, patch: { inNotes: true } })
    await request(socket, 'page:move', { id, parentId, sortOrder: Date.now() })
  }

  const placeNote = (id: string, target: string | null) => {
    const inShared = isShared(items.find((i) => i.id === id)?.folderId)
    if (!isGm && (inShared || isShared(target))) return
    run(async () => {
      if (isShared(target)) return moveShared(id, target)
      if (inShared) await moveShared(id, null)
      await moveItem(campaignId, cat, id, target)
    })
  }

  const canDropOn = (target: string) => canOrganize && (isGm || !isShared(target))
  const drag = (e: React.PointerEvent<HTMLElement>, name: string, onDrop: (s: Exclude<Spot, null>, at: PointerEvent) => void) =>
    pointerDrag(e, name, spotAt, (s) => setOver(s && s !== 'map' && s.folder && canDropOn(s.folder) ? s.folder : null), onDrop)

  const dropItemOn = (id: string, target: string | null) => {
    if (!canOrganize) return
    if (cat === 'notes') return placeNote(id, target)
    run(() => moveItem(campaignId, cat, id, target))
  }

  const dropFolderOn = (f: string, target: string | null) => {
    // Pasta da mesa e pasta pessoal não se misturam: uma vive na wiki, a outra é só de quem criou.
    if (f === target || (target && isShared(f) !== isShared(target))) return
    run(() => (isShared(f) ? moveShared(f, target) : moveFolder(campaignId, f, target)))
  }

  // Dentro da pasta da mesa quem decide é o mestre; fora dela, todo membro cria notas (as de quem não é mestre são pessoais).
  const lockedFolder = !isGm && isShared(folder)
  const canCreate = (isGm || cat === 'characters' || cat === 'notes') && !lockedFolder
  const canUpload = isGm && (cat === 'maps' || cat === 'props' || cat === 'attachments')
  // Pastas pessoais: todo membro organiza as suas notas.
  const canOrganize = isGm || cat === 'notes'
  const moveTargets = folders.filter((f) => f.id !== moving?.folderId && (isGm || !f.shared))

  return (
    <section aria-label={label} data-no-drop className="pointer-events-auto flex h-[22rem] w-full max-w-4xl animate-rise flex-col overflow-hidden rounded-2xl border border-line bg-panel/97 shadow-2xl shadow-black/40 backdrop-blur"
      // O painel fica dentro da área do mapa: sem isto, soltar um arquivo aqui criaria um token escondido embaixo dele.
      onDragOver={(e) => { e.stopPropagation(); if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDrop={(e) => { e.stopPropagation(); e.preventDefault(); if (canUpload && e.dataTransfer.files.length) onFiles(e.dataTransfer.files) }}>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <nav aria-label="Pastas" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          <button className={`rounded px-1.5 font-medium transition-colors hover:bg-raised ${folder ? 'text-muted' : ''}`} onClick={() => setFolder(null)} data-drop-folder="">{label}</button>
          {trail.map((f) => (
            <span key={f.id} className="flex items-center gap-1"><ChevronRight size={14} className="text-muted" />
              <button className="truncate rounded px-1.5 transition-colors hover:bg-raised" onClick={() => setFolder(f.id)} data-drop-folder={f.id}>{f.name}</button>
            </span>
          ))}
        </nav>
        <label className="flex items-center gap-1 rounded-lg border border-line bg-bg/60 px-2 py-1 text-sm focus-within:border-accent">
          <Search size={14} className="text-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" aria-label={`Buscar em ${label}`} className="w-32 bg-transparent outline-none" />
        </label>
        {canOrganize && !lockedFolder && (
          <button className="btn px-2 py-1 text-xs" disabled={busy} onClick={async () => {
            const n = await askText('Nome da pasta')
            if (n) run(() => (cat === 'notes' && isGm ? request(socket, 'page:create', { title: n, kind: 'folder', inNotes: true, parentId: isShared(folder) ? folder : null }) : createFolder(campaignId, cat, n, folder)))
          }}><FolderPlus size={14} /> Pasta</button>
        )}
        {canUpload && <button className="btn btn-primary px-2 py-1 text-xs" disabled={busy} onClick={create}><Upload size={14} /> Enviar</button>}
        {canCreate && !canUpload && <button className="btn btn-primary px-2 py-1 text-xs" disabled={busy} onClick={create}><Plus size={14} /> {cat === 'characters' ? 'Personagem' : cat === 'creatures' ? 'Criatura' : 'Nota'}</button>}
        <input ref={portrait} type="file" hidden accept="image/*" aria-label="Imagem do personagem" onChange={(e) => {
          const file = e.target.files?.[0], id = portraitOf.current
          if (file && id) run(async () => updateActor(campaignId, id, { avatarAssetId: (await upload(campaignId, file, 'image')).id }))
          e.target.value = ''
        }} />
        <input ref={fileInput} type="file" multiple hidden accept={cat === 'attachments' ? 'image/*,application/pdf' : 'image/*'} onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
        <button className="rounded p-1 text-muted transition-colors hover:bg-raised hover:text-ink" aria-label="Fechar biblioteca" onClick={onClose}><X size={16} /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
          {shownFolders.map((f) => (
            <li key={f.id} data-tile data-drop-folder={f.id} className="group relative animate-pop"
              onPointerDown={canOrganize && (isGm || !f.shared) ? (e) => drag(e, f.name, (s) => s !== 'map' && dropFolderOn(f.id, s.folder)) : undefined}>
              <button onDoubleClick={() => setFolder(f.id)} onClick={() => setFolder(f.id)}
                className={`flex w-full flex-col items-center gap-1 rounded-xl border p-2 transition-all hover:-translate-y-0.5 hover:border-accent/70 hover:bg-raised ${over === f.id ? 'border-accent bg-accent/15' : 'border-line bg-bg/40'}`}>
                {f.shared && <Users size={12} className="absolute top-2 left-2 text-info" aria-label="Pasta da mesa: todos veem" />}
                <Folder size={40} className="text-accent" fill="currentColor" fillOpacity={0.25} aria-hidden />
                {renaming === f.id
                  ? <input autoFocus defaultValue={f.name} aria-label="Nome da pasta" className="input px-1 py-0 text-center text-xs" onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => { setRenaming(null); if (e.target.value.trim() && e.target.value !== f.name) run(() => (f.shared ? request(socket, 'page:update', { id: f.id, patch: { title: e.target.value } }) : renameFolder(campaignId, f.id, e.target.value))) }}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                  : <span className="w-full truncate text-center text-xs">{f.name}</span>}
              </button>
              {canOrganize && (isGm || !f.shared) && (
                <span className="absolute top-1 right-1 hidden gap-0.5 group-hover:flex">
                  <TileAction label="Renomear" onClick={() => setRenaming(f.id)}><Pencil size={12} /></TileAction>
                  <TileAction label="Apagar pasta" danger onClick={async () => {
                    if (await ask(`Apagar a pasta "${f.name}"${f.shared ? ' para toda a mesa e da wiki' : ''}? O que está dentro sobe um nível.`, 'Apagar')) run(() => (f.shared ? request(socket, 'page:delete', { id: f.id }) : deleteFolder(campaignId, f.id)))
                  }}><Trash2 size={12} /></TileAction>
                </span>
              )}
            </li>
          ))}
          {shownItems.map((i) => {
            const note = cat === 'notes' ? wiki.byId.get(i.id) : undefined
            const canEdit = isGm || !!note?.ownerId
            const canMove = cat === 'notes' && (isGm || !isShared(i.folderId))
            return (
            <li key={i.id} data-tile className="group relative animate-pop"
              onPointerDown={(e) => drag(e, i.name, (s, at) => (s === 'map' ? onDropItem({ category: cat, id: i.id, name: i.name, image: i.image, pc: i.pc, mime: i.mime }, at) : dropItemOn(i.id, s.folder)))}>
              {isGm && note?.visibility === 'hidden' && !note.ownerId && <EyeOff size={12} className="absolute top-2 left-2 z-10 text-muted" aria-label="Oculta dos jogadores" />}
              <button onClick={() => openItem(i)} title={i.name}
                className={`flex w-full cursor-grab flex-col items-center gap-1 rounded-xl border bg-bg/40 p-2 transition-all hover:-translate-y-0.5 hover:border-accent/70 hover:bg-raised active:cursor-grabbing ${i.active ? 'border-crit' : 'border-line'}`}>
                <span className={`flex size-16 items-center justify-center overflow-hidden bg-line/60 bg-cover bg-center ${cat === 'characters' || cat === 'creatures' ? 'rounded-full' : 'rounded-lg'}`}
                  style={i.image ? { backgroundImage: `url(/api/assets/${i.image})` } : undefined}>
                  {!i.image && (cat === 'notes' ? <FileText className="text-muted" /> : cat === 'attachments' ? <Paperclip className="text-muted" /> : cat === 'creatures' ? <Skull className="text-muted" /> : <ScrollText className="text-muted" />)}
                </span>
                {renaming === i.id
                  ? <input autoFocus defaultValue={i.name} aria-label="Novo nome" className="input px-1 py-0 text-center text-xs" onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => { setRenaming(null); if (e.target.value.trim() && e.target.value !== i.name) run(() => (cat === 'notes' ? request(socket, 'page:update', { id: i.id, patch: { title: e.target.value } }) : renameItem(campaignId, cat, i.id, e.target.value))) }}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                  : <span className="w-full truncate text-center text-xs">{i.name}</span>}
                {i.active && <span className="text-[10px] text-crit">ativa</span>}
              </button>
              {(canEdit || canMove) && (
                <span className="absolute top-1 right-1 hidden gap-0.5 group-hover:flex">
                  {cat === 'maps' && !i.active && <TileAction label="Ativar para todos" onClick={() => run(() => request(socket, 'scene:activate', { sceneId: i.id }).then(() => onOpenScene(i.id)))}><Play size={12} /></TileAction>}
                  {cat === 'attachments' && <TileAction label="Mostrar aos jogadores" onClick={() => request(socket, 'handout:show', { assetId: i.id }).catch(onError)}><Eye size={12} /></TileAction>}
                  {cat === 'notes' && isGm && !wiki.byId.get(i.id)?.ownerId && <TileAction label="Mostrar aos jogadores" onClick={() => request(socket, 'page:show', { id: i.id }).catch(onError)}><Eye size={12} /></TileAction>}
                  {cat === 'notes' && isGm && !wiki.byId.get(i.id)?.ownerId && wiki.byId.get(i.id)?.visibility !== 'hidden' && <TileAction label="Ocultar dos jogadores" onClick={() => request(socket, 'page:update', { id: i.id, patch: { visibility: 'hidden' } }).catch(onError)}><EyeOff size={12} /></TileAction>}
                  {isGm && note?.visibility === 'hidden' && !note.ownerId && <TileAction label="Liberar para os jogadores sem abrir na tela deles" onClick={() => request(socket, 'page:update', { id: i.id, patch: { visibility: 'visible' } }).catch(onError)}><LockOpen size={12} /></TileAction>}
                  {(cat === 'characters' || cat === 'creatures') && <TileAction label="Trocar imagem" onClick={() => { portraitOf.current = i.id; portrait.current?.click() }}><ImageIcon size={12} /></TileAction>}
                  {canMove && <TileAction label="Mover para pasta" onClick={() => setMoving(i)}><FolderInput size={12} /></TileAction>}
                  {canEdit && <TileAction label="Renomear" onClick={() => setRenaming(i.id)}><Pencil size={12} /></TileAction>}
                  {cat === 'notes' && !note?.ownerId
                    ? isGm && !isShared(i.folderId) && <TileAction label="Tirar de Notas" onClick={() => request(socket, 'page:update', { id: i.id, patch: { inNotes: false } }).catch(onError)}><BookmarkX size={12} /></TileAction>
                    : canEdit && <TileAction label={`Apagar ${i.name}`} danger onClick={() => removeItem(i)}><Trash2 size={12} /></TileAction>}
                </span>
              )}
            </li>
            )
          })}
        </ul>
        {!shownFolders.length && !shownItems.length && (
          <p className="flex h-40 items-center justify-center text-center text-sm text-muted">
            {search ? 'Nada encontrado.' : canUpload ? 'Vazio. Clique em Enviar ou solte arquivos aqui.' : canCreate ? 'Vazio. Crie o primeiro.' : 'Nada por aqui ainda.'}
          </p>
        )}
      </div>
      {isGm && <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">{cat === 'notes' ? 'Pasta com o ícone de grupo é da mesa: toda a mesa vê o que está nela, menos as notas ocultas.' : 'Arraste para o mapa. Arraste para uma pasta (ou para o caminho lá em cima) para organizar.'}</p>}
      {!isGm && cat === 'characters' && <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">Arraste para o mapa para colocar o token.</p>}
      {!isGm && cat === 'notes' && <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">Pasta com o ícone de grupo é do mestre. As outras só existem para você.</p>}
      {moving && (
        <dialog ref={(d) => { if (d && !d.open) d.showModal() }} onClose={() => setMoving(null)} onClick={(e) => e.target === e.currentTarget && setMoving(null)}
          aria-label={`Mover ${moving.name}`} className="card m-auto w-full max-w-xs text-ink backdrop:bg-black/50">
          <ul className="max-h-72 space-y-1 overflow-y-auto p-2">
            {moving.folderId && <li><button className="btn btn-ghost w-full justify-start" onClick={() => { placeNote(moving.id, null); setMoving(null) }}>{label}</button></li>}
            {moveTargets.map((f) => (
              <li key={f.id}>
                <button className="btn btn-ghost w-full justify-start" onClick={() => { placeNote(moving.id, f.id); setMoving(null) }}>
                  <Folder size={14} className="shrink-0 text-accent" aria-hidden /> <span className="truncate">{f.name}</span>
                  {f.shared && <Users size={12} className="ml-auto shrink-0 text-info" aria-hidden />}
                </button>
              </li>
            ))}
            {!moving.folderId && !moveTargets.length && <li className="px-2 py-1.5 text-sm text-muted">Crie uma pasta primeiro.</li>}
          </ul>
        </dialog>
      )}
    </section>
  )
}

function TileAction({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`rounded-md bg-panel/95 p-1 shadow transition-colors ${danger ? 'text-muted hover:text-fumble' : 'text-muted hover:text-ink'}`}>{children}</button>
  )
}
