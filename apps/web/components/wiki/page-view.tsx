'use client'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Editor } from '@tiptap/react'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import { can } from '@grimorio/core'
import { request, useRealtime, useSocketEvent } from '../realtime'
import { useWiki } from './context'
import { CollabEditor } from './editor'
import { PageIcon } from './tree'
import { BUILTIN_TEMPLATES } from './templates'
import { MapPage } from './map-page'
import { TimelinePage } from './timeline-page'

const BoardPage = dynamic(() => import('./board-page').then((m) => m.BoardPage), { ssr: false, loading: OpeningBoard })

function OpeningBoard() {
  return <p className="p-8 text-muted">{useTranslations('wiki')('board')}</p>
}

export function PageView({ pageId }: { pageId: string }) {
  const { byId, pages, isGm, campaignId } = useWiki()
  const { socket, me } = useRealtime()
  const router = useRouter()
  const t = useTranslations('wiki')
  const tc = useTranslations('common')
  const params = useSearchParams()
  const p = byId.get(pageId)
  // Nota pessoal só chega ao próprio dono.
  const mine = !!p?.ownerId
  const canEdit = !!p && can(me, 'page.edit', p)

  // Modelo pronto (W10): preenche a página nova na primeira abertura, depois que o documento sincronizou vazio.
  const modelo = params.get('modelo')
  const onReady = useCallback((editor: Editor, provider: HocuspocusProvider) => {
    const tpl = modelo && BUILTIN_TEMPLATES[modelo]
    if (!tpl) return
    const apply = async () => {
      if (!editor.isEmpty) return
      const content = await Promise.all(tpl.doc.content.map(async (n) => (n as { type: string }).type === 'secretBlock'
        ? { type: 'secretBlock', attrs: { id: (await request<{ id: string }>(socket, 'secret:create', { pageId })).id } }
        : n))
      editor.commands.setContent({ type: 'doc', content })
      router.replace(`/c/${campaignId}/wiki/${pageId}`)
    }
    if (provider.isSynced) apply()
    else provider.on('synced', apply)
  }, [modelo, socket, pageId, router, campaignId])

  if (!p) return <p className="p-8 text-muted">{pages.length ? t('notFound') : tc('loading')}</p>

  return (
    <article className={p.kind === 'board' ? 'flex h-full flex-col' : 'mx-auto max-w-3xl px-6 py-8'}>
      <header className={`flex items-center gap-3 ${p.kind === 'board' ? 'border-b border-line px-4 py-2' : 'mb-6'}`}>
        <span className="text-2xl" style={{ color: p.color ?? undefined }}><PageIcon p={p} size={24} /></span>
        {isGm || mine
          ? <input key={p.title} defaultValue={p.title} aria-label={t('title')} className="wiki-title min-w-0 flex-1 bg-transparent font-serif text-3xl focus:text-accent"
              onBlur={(e) => e.target.value.trim() && e.target.value !== p.title && request(socket, 'page:update', { id: p.id, patch: { title: e.target.value.trim() } })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
          : <h1 className="font-serif text-3xl">{p.title}</h1>}
      </header>
      {p.kind === 'text' && (
        <>
          <CollabEditor key={`${p.id}${canEdit}`} docName={`page:${p.id}`} editable={canEdit} onReady={onReady} />
          <Backlinks id={p.id} />
        </>
      )}
      {p.kind === 'map' && <MapPage pageId={p.id} />}
      {p.kind === 'timeline' && <TimelinePage pageId={p.id} canEdit={canEdit} />}
      {p.kind === 'board' && <div className="min-h-0 flex-1"><BoardPage pageId={p.id} /></div>}
      {p.kind === 'folder' && <FolderContents id={p.id} />}
    </article>
  )
}

function FolderContents({ id }: { id: string }) {
  const { pages, campaignId } = useWiki()
  const t = useTranslations('wiki')
  const kids = pages.filter((x) => x.parentId === id)
  if (!kids.length) return <p className="text-muted">{t('folderEmpty')}</p>
  return (
    <ul className="space-y-1">
      {kids.map((k) => <li key={k.id}><Link className="flex items-center gap-2 rounded-md p-2 hover:bg-raised" href={`/c/${campaignId}/wiki/${k.id}`}><PageIcon p={k} /> <span className="truncate">{k.title}</span></Link></li>)}
    </ul>
  )
}

// Backlinks (W5): páginas que apontam para esta, já filtradas pelo servidor.
function Backlinks({ id }: { id: string }) {
  const { socket, campaignId } = useRealtime()
  const t = useTranslations('wiki')
  const [links, setLinks] = useState<{ id: string; title: string }[]>([])
  const load = useCallback(() => { request<typeof links>(socket, 'wiki:backlinks', { id }).then(setLinks).catch(() => {}) }, [socket, id])
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t) }, [load])
  useSocketEvent('wiki:changed', load)
  if (!links.length) return null
  return (
    <footer className="mt-12 border-t border-line pt-4 text-sm">
      <h2 className="label">{t('citedIn')}</h2>
      <ul className="flex flex-wrap gap-2">
        {links.map((l) => <li key={l.id}><Link className="text-accent hover:underline" href={`/c/${campaignId}/wiki/${l.id}`}>{l.title}</Link></li>)}
      </ul>
    </footer>
  )
}
