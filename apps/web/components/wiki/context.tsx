'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { canBeNote, noteShelf } from '@grimorio/core'
import { request, useRealtime, useSocketEvent } from '../realtime'

export { canBeNote }
// A árvore avisa o quadro embaixo do ponteiro; detail: { id, clientX, clientY }.
export const PAGE_DROP = 'wiki:page-drop'
export type PageNode = { id: string; parentId: string | null; ownerId: string | null; title: string; icon: string | null; color: string | null; sortOrder: number; visibility: 'hidden' | 'visible' | 'editable'; kind: 'text' | 'map' | 'timeline' | 'board' | 'folder'; isTemplate: boolean; inNotes: boolean }
export type WikiMember = { id: string; name: string; role: string; characters: string[]; image: string | null }
type Ctx = { pages: PageNode[]; notes: { page: PageNode; folderId: string | null }[]; noteFolders: { page: PageNode; parentId: string | null }[]; all: PageNode[]; byId: Map<string, PageNode>; reload: () => void; campaignId: string; isGm: boolean; members: WikiMember[]; me: { id: string; name: string } }
const WikiContext = createContext<Ctx | null>(null)

// Árvore da wiki compartilhada entre barra lateral, links [[ ]] e quadros; recarrega quando alguém muda algo.
export function WikiProvider({ children, members, meName }: { children: React.ReactNode; members: WikiMember[]; meName: string }) {
  const { socket, campaignId, me } = useRealtime()
  const [all, setAll] = useState<PageNode[]>([])
  const reload = useCallback(() => { request<{ pages: PageNode[] }>(socket, 'wiki:tree').then((r) => setAll(r.pages)).catch(() => {}) }, [socket])
  useEffect(() => {
    if (socket.connected) reload()
    socket.on('connect', reload)
    return () => void socket.off('connect', reload)
  }, [socket, reload])
  useSocketEvent('wiki:changed', reload)
  const byId = useMemo(() => new Map(all.map((p) => [p.id, p])), [all])
  // Nota pessoal não entra na wiki; da wiki, só vai para o painel de Notas o que o mestre indicar, direto ou pela pasta.
  const pages = useMemo(() => all.filter((p) => !p.ownerId), [all])
  const { notes, folders: noteFolders } = useMemo(() => noteShelf(all), [all])
  return <WikiContext.Provider value={{ pages, notes, noteFolders, all, byId, reload, campaignId, isGm: me.role === 'gm', members, me: { id: me.userId, name: meName } }}>{children}</WikiContext.Provider>
}

export function useWiki() {
  const c = useContext(WikiContext)
  if (!c) throw new Error('useWiki fora de <WikiProvider>')
  return c
}
