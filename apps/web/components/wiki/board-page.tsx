'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Excalidraw, convertToExcalidrawElements, exportToBlob, exportToSvg, reconcileElements, viewportCoordsToSceneCoords, CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI, BinaryFileData } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import { Download } from 'lucide-react'
import { request, useRealtime, useSocketEvent } from '../realtime'
import { upload } from '@/lib/upload'
import { PAGE_DROP, useWiki } from './context'

type El = { id: string; version: number; isDeleted?: boolean; type: string; customData?: { pageId?: string | null; hidden?: boolean }; text?: string; containerId?: string | null }

// Fontes do Excalidraw servidas pelo próprio app (copiadas para /public/fonts), nada de CDN.
if (typeof window !== 'undefined') (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/'

// O tema escuro do Excalidraw passa o canvas por invert(93%) hue-rotate(180deg): estas cores viram #1b1f2b, #313849 e #ededed na tela.
const CANVAS_BG = '#ebf0fe', CARD_BG = '#cbd3e7', CARD_TEXT = '#000000'

// Quadro infinito (W13–W18). O servidor guarda cada elemento por versão e esconde cartões de páginas ocultas.
export function BoardPage({ pageId }: { pageId: string }) {
  const { socket, campaignId } = useRealtime()
  const { byId, me } = useWiki()
  const router = useRouter()
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [init, setInit] = useState<{ elements: El[]; files: BinaryFileData[]; canEdit: boolean } | null>(null)
  const sent = useRef(new Map<string, number>())
  const uploaded = useRef(new Set<string>())
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const root = useRef<HTMLDivElement>(null)
  const pending = useRef(new Map<string, El>())
  const collaborators = useRef(new Map<string, { username: string; pointer: { x: number; y: number; tool: 'pointer' } }>())

  const join = useCallback(() => request<{ elements: El[]; files: BinaryFileData[]; canEdit: boolean }>(socket, 'board:join', { pageId }).then((r) => {
    for (const e of r.elements) sent.current.set(e.id, e.version)
    for (const f of r.files) uploaded.current.add(f.id)
    setInit(r)
  }), [socket, pageId])
  useEffect(() => { join() }, [join])
  useSocketEvent('board:reload', useCallback(() => { join().then(() => api?.updateScene({ elements: [] })) }, [join, api]))

  useSocketEvent<{ pageId: string; elements: El[] }>('board:elements', useCallback((m) => {
    if (m.pageId !== pageId || !api) return
    for (const e of m.elements) sent.current.set(e.id, Math.max(sent.current.get(e.id) ?? 0, e.version))
    const merged = reconcileElements(api.getSceneElementsIncludingDeleted(), m.elements as never, api.getAppState())
    api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER })
  }, [pageId, api]))
  useSocketEvent<{ pageId: string; files: BinaryFileData[] }>('board:files', useCallback((m) => {
    if (m.pageId !== pageId || !api) return
    for (const f of m.files) uploaded.current.add(f.id)
    api.addFiles(m.files)
  }, [pageId, api]))
  useSocketEvent<{ userId: string; name: string; x: number; y: number }>('board:pointer', useCallback((m) => {
    if (!api) return
    collaborators.current.set(m.userId, { username: m.name, pointer: { x: m.x, y: m.y, tool: 'pointer' } })
    api.updateScene({ collaborators: new Map(collaborators.current) as never })
  }, [api]))

  // W15: cartão de página mostra sempre o título atual (renomear atualiza o cartão).
  useEffect(() => {
    if (!api || !init?.canEdit) return
    const els = api.getSceneElements() as unknown as El[]
    const stale = els.filter((e) => e.type === 'text' && e.customData?.pageId && byId.get(e.customData.pageId) && byId.get(e.customData.pageId)!.title !== e.text)
    if (!stale.length) return
    api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((e) => {
      const el = e as unknown as El
      const t = stale.find((s) => s.id === el.id)
      return t ? ({ ...e, text: byId.get(t.customData!.pageId!)!.title, originalText: byId.get(t.customData!.pageId!)!.title, version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) } as typeof e) : e
    }) })
  }, [api, byId, init?.canEdit])

  // Manda só o que mudou de versão, em lotes de 120 ms.
  const onChange = (elements: readonly unknown[], _: unknown, files: Record<string, BinaryFileData>) => {
    if (!init?.canEdit) return
    for (const e of elements as El[]) {
      if ((sent.current.get(e.id) ?? -1) < e.version) pending.current.set(e.id, e)
    }
    for (const f of Object.values(files)) {
      if (uploaded.current.has(f.id) || !f.dataURL.startsWith('data:')) continue
      uploaded.current.add(f.id)
      fetch(f.dataURL).then((r) => r.blob()).then((b) => upload(campaignId, new File([b], 'quadro', { type: f.mimeType }), 'image')).then((a) => {
        const file = { id: f.id, mimeType: f.mimeType, dataURL: a.url, created: f.created }
        api?.addFiles([file as BinaryFileData])
        request(socket, 'board:files', { pageId, files: [file] })
      })
    }
    if (!pending.current.size || timer.current) return
    timer.current = setTimeout(() => {
      const batch = [...pending.current.values()]
      pending.current.clear()
      timer.current = undefined
      for (const e of batch) sent.current.set(e.id, e.version)
      request(socket, 'board:update', { pageId, elements: batch }).catch(() => {})
    }, 120)
  }

  // W15: arrastar uma página da árvore cria um cartão com título; clicar abre a página.
  useEffect(() => {
    const el = root.current
    if (!el || !api) return
    const onDrop = (e: Event) => {
      const { id, clientX, clientY } = (e as CustomEvent<{ id: string; clientX: number; clientY: number }>).detail
      const p = byId.get(id)
      if (!p) return
      const { x, y } = viewportCoordsToSceneCoords({ clientX, clientY }, api.getAppState())
      const card = convertToExcalidrawElements([{
        type: 'rectangle', x, y, width: 240, height: 90, backgroundColor: CARD_BG, fillStyle: 'solid', strokeColor: p.color ?? '#c9a24a', roundness: { type: 3 },
        link: `/c/${campaignId}/wiki/${p.id}`, customData: { pageId: p.id },
        label: { text: p.title, strokeColor: CARD_TEXT, fontSize: 20 },
      } as never])
      for (const c of card) (c as unknown as El).customData = { pageId: p.id }
      api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...card], captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    }
    el.addEventListener(PAGE_DROP, onDrop)
    return () => el.removeEventListener(PAGE_DROP, onDrop)
  }, [api, byId, campaignId])

  const exportAs = async (kind: 'png' | 'svg') => {
    if (!api) return
    const args = { elements: api.getSceneElements(), appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: true }, files: api.getFiles() }
    const blob = kind === 'png' ? await exportToBlob({ ...args, mimeType: 'image/png' }) : new Blob([(await exportToSvg(args)).outerHTML], { type: 'image/svg+xml' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `quadro.${kind}` })
    a.click()
  }

  if (!init) return <p className="p-8 text-muted">Abrindo quadro…</p>
  return (
    <div ref={root} data-board-drop className="relative h-full">
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <button className="btn bg-panel text-xs" onClick={() => exportAs('png')}><Download size={12} /> PNG</button>
        <button className="btn bg-panel text-xs" onClick={() => exportAs('svg')}><Download size={12} /> SVG</button>
      </div>
      <Excalidraw
        excalidrawAPI={(a) => { setApi(a); a.addFiles(init.files) }}
        initialData={{ elements: init.elements as never, appState: { viewBackgroundColor: CANVAS_BG }, scrollToContent: true }}
        theme="dark"
        langCode="pt-BR"
        isCollaborating
        viewModeEnabled={!init.canEdit}
        onChange={onChange as never}
        onPointerUpdate={({ pointer }) => request(socket, 'board:pointer', { pageId, x: pointer.x, y: pointer.y }).catch(() => {})}
        onLinkOpen={(el, ev) => {
          const link = (el as { link?: string | null }).link
          if (link?.startsWith('/')) { ev.preventDefault(); router.push(link) }
        }}
      />
      <span className="sr-only">{me.name}</span>
    </div>
  )
}
