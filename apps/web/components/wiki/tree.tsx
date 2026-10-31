'use client'
import { ask } from '@/components/confirm'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Download, Eye, EyeOff, FileText, Folder, Map, MoreHorizontal, PenLine, Plus, Presentation, Trash2, Upload, Waypoints } from 'lucide-react'
import { DynamicIcon, type IconName } from 'lucide-react/dynamic'
import { pointerDrag } from '@/lib/pointer-drag'
import { request, useRealtime } from '../realtime'
import { canBeNote, PAGE_DROP, useWiki, type PageNode } from './context'
import { SearchDialog } from './search'
import { BUILTIN_TEMPLATES } from './templates'

const KIND_ICON = { text: FileText, map: Map, timeline: Waypoints, board: Presentation, folder: Folder }
const KINDS = ['text', 'map', 'timeline', 'board', 'folder'] as const

export function PageIcon({ p, size = 14 }: { p: Pick<PageNode, 'icon' | 'kind' | 'color'>; size?: number }) {
  if (p.icon && /\p{Extended_Pictographic}/u.test(p.icon)) return <span style={{ fontSize: size }} aria-hidden>{p.icon}</span>
  if (p.icon) return <DynamicIcon name={p.icon as IconName} size={size} color={p.color ?? undefined} fallback={() => null} />
  const Icon = KIND_ICON[p.kind]
  return <Icon size={size} color={p.color ?? undefined} aria-hidden />
}

type Create = (kind: PageNode['kind'], parentId: string | null, template?: string) => void
type Spot = { id: string; where: 'in' | 'before' } | 'root' | HTMLElement

// Onde a página cairia: em outra página (no meio aninha, na borda de cima reordena), no vazio da árvore ou num quadro.
function spotAt(x: number, y: number): Spot | null {
  const hit = document.elementFromPoint(x, y)
  if (hit?.matches('[data-tree-root]')) return 'root'
  const el = hit?.closest<HTMLElement>('[data-tree-page],[data-board-drop]')
  if (!el) return null
  if (!el.dataset.treePage) return el
  const r = el.getBoundingClientRect()
  return { id: el.dataset.treePage, where: y - r.top < r.height * 0.3 ? 'before' : 'in' }
}

function NewMenu({ parentId, onCreate }: { parentId: string | null; onCreate: Create }) {
  const { pages } = useWiki()
  const t = useTranslations('wiki')
  return (
    <>
      {KINDS.map((k) => <button key={k} className="btn btn-ghost w-full justify-start" onClick={() => onCreate(k, parentId)}>{t(`kinds.${k}`)}</button>)}
      <p className="label px-2 pt-2">{t('templates')}</p>
      {Object.entries(BUILTIN_TEMPLATES).map(([k, tpl]) => <button key={k} className="btn btn-ghost w-full justify-start" onClick={() => onCreate('text', parentId, k)}>{tpl.label}</button>)}
      {pages.filter((p) => p.isTemplate).map((p) => <button key={p.id} className="btn btn-ghost w-full justify-start" onClick={() => onCreate(p.kind, parentId, p.id)}>{p.title}</button>)}
    </>
  )
}

// Árvore de páginas (W1): arrastar no meio de outra página aninha; na borda de cima, reordena.
export function WikiTree() {
  const { pages, byId, isGm, campaignId } = useWiki()
  const { socket } = useRealtime()
  const router = useRouter()
  const t = useTranslations('wiki')
  const [menu, setMenu] = useState(false)
  const [error, setError] = useState('')
  const [over, setOver] = useState<string | null>(null)
  const roots = pages.filter((p) => !p.parentId || !pages.some((x) => x.id === p.parentId))

  const drag = (e: React.PointerEvent<HTMLElement>, p: PageNode) => {
    const move = (payload: object) => request(socket, 'page:move', { id: p.id, ...payload }).catch((er) => setError(er.message))
    pointerDrag(e, p.title, spotAt, (s) => setOver(s && s !== 'root' && !(s instanceof HTMLElement) && s.id !== p.id ? `${s.where}:${s.id}` : null), (s, at) => {
      if (s === 'root') return void move({ parentId: null, sortOrder: Date.now() })
      if (s instanceof HTMLElement) return void s.dispatchEvent(new CustomEvent(PAGE_DROP, { detail: { id: p.id, clientX: at.clientX, clientY: at.clientY } }))
      const to = byId.get(s.id)
      if (!to || to.id === p.id) return
      if (s.where === 'in') return void move({ parentId: to.id, sortOrder: Date.now() })
      const sibs = pages.filter((x) => x.parentId === to.parentId && x.id !== p.id)
      const prev = sibs[sibs.findIndex((x) => x.id === to.id) - 1]
      move({ parentId: to.parentId, sortOrder: prev ? (prev.sortOrder + to.sortOrder) / 2 : to.sortOrder - 1 })
    })
  }

  const create: Create = async (kind, parentId, template) => {
    setMenu(false)
    const builtin = template && BUILTIN_TEMPLATES[template]
    const title = builtin ? builtin.label : kind === 'text' ? t('newPage') : t(`kinds.${kind}`)
    try {
      const r = await request<{ id: string }>(socket, 'page:create', { parentId, title, kind, fromTemplate: builtin ? null : template })
      router.push(`/c/${campaignId}/wiki/${r.id}${builtin ? `?modelo=${template}` : ''}`)
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <nav aria-label={t('pages')} className="flex h-full flex-col gap-2 p-2 text-sm">
      <SearchDialog />
      {isGm && (
        <div className="relative">
          <button className="btn w-full" onClick={() => setMenu(!menu)}><Plus size={14} /> {t('newPage')}</button>
          {menu && (
            <div className="card absolute top-full z-20 mt-1 w-full space-y-1 p-1 shadow-xl">
              <NewMenu parentId={null} onCreate={create} />
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-fumble">{error}</p>}
      <ul data-tree-root className="min-h-0 flex-1 overflow-y-auto">
        {roots.map((p) => <TreeItem key={p.id} p={p} depth={0} over={over} onDrag={drag} onCreate={create} onError={setError} />)}
        {!pages.length && <li className="px-2 text-muted">{isGm ? t('empty') : t('emptyPlayer')}</li>}
      </ul>
      {isGm && (
        <div className="flex gap-1 border-t border-line pt-2">
          <a className="btn btn-ghost flex-1 text-xs" href={`/c/${campaignId}/wiki/export`} title={t('exportHint')}><Download size={14} /> {t('export')}</a>
          <label className="btn btn-ghost flex-1 cursor-pointer text-xs" title={t('importHint')}>
            <Upload size={14} /> {t('import')}
            <input type="file" accept=".zip" hidden onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              const body = new FormData()
              body.set('file', f)
              const res = await fetch(`/c/${campaignId}/wiki/export`, { method: 'POST', body })
              if (!res.ok) setError((await res.json()).error ?? t('importFailed'))
              else router.refresh()
            }} />
          </label>
        </div>
      )}
    </nav>
  )
}

function TreeItem({ p, depth, over, onDrag, onCreate, onError }: { p: PageNode; depth: number; over: string | null; onDrag: (e: React.PointerEvent<HTMLElement>, p: PageNode) => void; onCreate: Create; onError: (m: string) => void }) {
  const { pages, isGm, campaignId } = useWiki()
  const { socket } = useRealtime()
  const path = usePathname()
  const router = useRouter()
  const t = useTranslations('wiki')
  const [open, setOpen] = useState(true)
  const [edit, setEdit] = useState(false)
  const [adding, setAdding] = useState(false)
  const folder = p.kind === 'folder'
  const kids = pages.filter((x) => x.parentId === p.id)
  const active = path.endsWith(`/wiki/${p.id}`)
  const act = (event: string, payload: object) => request(socket, event, payload).catch((e) => onError(e.message))

  return (
    <li>
      <div data-tree-page={p.id} onPointerDown={isGm ? (e) => onDrag(e, p) : undefined}
        className={`group flex items-center gap-1 rounded-md pr-1 select-none ${active ? 'bg-bg text-accent' : 'hover:bg-bg'} ${over === `in:${p.id}` ? 'ring-1 ring-accent' : ''} ${over === `before:${p.id}` ? 'border-t-2 border-accent' : ''}`}
        style={{ paddingLeft: depth * 12 + 4 }}>
        <button className={`size-4 shrink-0 text-muted ${kids.length ? '' : 'invisible'}`} aria-label={open ? t('collapse') : t('expand')} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Link href={`/c/${campaignId}/wiki/${p.id}`} draggable={false} className="flex min-w-0 flex-1 items-center gap-1.5 py-1">
          <PageIcon p={p} />
          <span className="truncate">{p.title}</span>
          {isGm && p.visibility === 'hidden' && <EyeOff size={12} className="shrink-0 text-muted" aria-label={t('hiddenBadge')} />}
          {isGm && p.visibility === 'editable' && <PenLine size={12} className="shrink-0 text-muted" aria-label={t('editableBadge')} />}
        </Link>
        {isGm && (
          <span className="hidden gap-0.5 group-hover:flex">
            <button aria-label={t('newChild', { name: p.title })} title={t('newChild', { name: p.title })} onClick={() => (setOpen(true), folder ? setAdding(!adding) : onCreate('text', p.id))} className="text-muted hover:text-ink"><Plus size={14} /></button>
            <button aria-label={t('options', { name: p.title })} onClick={() => setEdit(!edit)} className="text-muted hover:text-ink"><MoreHorizontal size={14} /></button>
          </span>
        )}
      </div>
      {edit && (
        <div className="card mx-2 my-1 space-y-2 p-2 text-xs" style={{ marginLeft: depth * 12 + 8 }}>
          <div className="flex gap-1">
            <input className="input px-2 py-1 text-xs" aria-label={t('icon')} placeholder="🏰 ou castle" defaultValue={p.icon ?? ''} onBlur={(e) => act('page:update', { id: p.id, patch: { icon: e.target.value.trim() || null } })} />
            <input type="color" aria-label={t('color')} defaultValue={p.color ?? '#c9a24a'} onChange={(e) => act('page:update', { id: p.id, patch: { color: e.target.value } })} />
          </div>
          <div className="flex gap-1">
            {(p.kind === 'board' || p.kind === 'timeline' ? ['hidden', 'visible', 'editable'] as const : ['hidden', 'visible'] as const).map((v) => (
              <button key={v} className={`btn flex-1 px-1 py-0.5 text-xs ${p.visibility === v ? 'border-accent text-accent' : ''}`} onClick={() => act('page:update', { id: p.id, patch: { visibility: v } })}>
                {v === 'hidden' ? <><EyeOff size={12} /> {t('hidden')}</> : v === 'visible' ? <><Eye size={12} /> {t('visible')}</> : <><PenLine size={12} /> {t('editable')}</>}
              </button>
            ))}
          </div>
          {(canBeNote(p) || folder) && <label className="flex items-center gap-2"><input type="checkbox" checked={p.inNotes} onChange={(e) => act('page:update', { id: p.id, patch: { inNotes: e.target.checked } })} /> {t('inNotes')}</label>}
          {!folder && <label className="flex items-center gap-2"><input type="checkbox" checked={p.isTemplate} onChange={(e) => act('page:update', { id: p.id, patch: { isTemplate: e.target.checked } })} /> {t('asTemplate')}</label>}
          <button className="btn w-full px-1 py-0.5 text-xs text-fumble" onClick={async () => { if (await ask(t(folder ? 'deleteFolderConfirm' : 'deleteConfirm', { name: p.title }))) act('page:delete', { id: p.id }).then(() => active && router.push(`/c/${campaignId}/wiki`)) }}><Trash2 size={12} /> {t('delete')}</button>
        </div>
      )}
      {adding && <div className="card my-1 mr-2 space-y-1 p-1" style={{ marginLeft: depth * 12 + 8 }}><NewMenu parentId={p.id} onCreate={(k, parent, template) => (setAdding(false), onCreate(k, parent, template))} /></div>}
      {open && kids.length > 0 && <ul>{kids.map((k) => <TreeItem key={k.id} p={k} depth={depth + 1} over={over} onDrag={onDrag} onCreate={onCreate} onError={onError} />)}</ul>}
    </li>
  )
}
