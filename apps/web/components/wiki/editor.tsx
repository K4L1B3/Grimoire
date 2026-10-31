'use client'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ImagePlus, Lock } from 'lucide-react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { Selection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extensions'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { request, useRealtime } from '../realtime'
import { upload } from '@/lib/upload'
import { useWiki, type PageNode } from './context'
import { Callout, PageLink, SecretBlock, suggestion, type MenuState } from './extensions'

// Hocuspocus no mesmo processo do realtime, em /collab (o Caddy junta tudo no mesmo domínio em produção).
function collabUrl() {
  const base = process.env.NEXT_PUBLIC_RT_URL || location.origin
  return `${base.replace(/^http/, 'ws')}/collab`
}

const COLORS = ['#e06c75', '#61afef', '#98c379', '#c678dd', '#e5c07b', '#56b6c2', '#d19a66']
const colorOf = (id: string) => COLORS[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length]!

type Slash = { label: string; hint: string; gm?: boolean; run: (e: Editor) => void | Promise<void> }

type Props = { docName: string; editable: boolean; placeholder?: string; nested?: boolean; onReady?: (editor: Editor, provider: HocuspocusProvider) => void }

// Editor colaborativo (W2, W3): Yjs + Hocuspocus, cursores com nome de quem edita.
// A conexão nasce e morre dentro do efeito: com useMemo, o Strict Mode destruiria o provider e reusaria o morto.
export function CollabEditor(props: Props) {
  const [conn, setConn] = useState<{ ydoc: Y.Doc; provider: HocuspocusProvider } | null>(null)
  useEffect(() => {
    const ydoc = new Y.Doc()
    const provider = new HocuspocusProvider({ url: collabUrl(), name: props.docName, document: ydoc, token: 'sessao' })
    setConn({ ydoc, provider })
    // Voltou a internet: reconecta já, sem esperar o backoff; o Yjs junta o que foi escrito offline.
    const online = () => provider.connect()
    window.addEventListener('online', online)
    return () => { window.removeEventListener('online', online); provider.destroy(); ydoc.destroy() }
  }, [props.docName])
  return conn ? <Editor_ key={conn.ydoc.guid} {...props} {...conn} /> : null
}

function Editor_({ docName, editable, placeholder, nested, onReady, ydoc, provider }: Props & { ydoc: Y.Doc; provider: HocuspocusProvider }) {
  const { socket, campaignId } = useRealtime()
  // Jogador só escreve nas próprias notas, então os [[ ]] dele podem citá-las sem nada vazar para a wiki.
  const { all: pages, isGm, me } = useWiki()
  const pagesRef = useRef<PageNode[]>(pages)
  pagesRef.current = pages
  const [menu, setMenu] = useState<MenuState<Slash | PageNode | { create: string }>>(null)
  const [sel, setSel] = useState(0)
  const menuRef = useRef({ menu, sel })
  menuRef.current = { menu, sel }
  const [error, setError] = useState('')
  const t = useTranslations('wiki')

  // Sobe e insere no cursor; a seleção acompanha quem edita junto enquanto o envio não termina.
  const addImages = async (view: EditorView, files: File[]) => {
    setError('')
    try {
      for (const f of files) {
        const { url } = await upload(campaignId, f, 'image')
        if (view.isDestroyed) return
        view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.image!.create({ src: url })))
        // O cursor sai da imagem recém-inserida, senão a próxima a substituiria. Só agora: no fim do doc, o parágrafo seguinte nasce neste dispatch.
        const { doc, selection, tr } = view.state
        view.dispatch(tr.setSelection(Selection.near(doc.resolve(selection.to))))
      }
    } catch (e) { setError((e as Error).message) }
  }

  // Teclas do menu de sugestão: setas escolhem, Enter aplica.
  const key = (e: KeyboardEvent) => {
    const { menu, sel } = menuRef.current
    if (!menu?.items.length) return false
    if (e.key === 'ArrowDown') return setSel((sel + 1) % menu.items.length), true
    if (e.key === 'ArrowUp') return setSel((sel - 1 + menu.items.length) % menu.items.length), true
    if (e.key === 'Enter' || e.key === 'Tab') return menu.select(menu.items[sel]!), true
    return false
  }
  // Os dois menus (/ e [[) dividem o mesmo popup.
  const ui = { set: (s: MenuState<any>) => (setMenu(s), setSel(0)), key }

  const addSecret = async (e: Editor) => {
    const { id } = await request<{ id: string }>(socket, 'secret:create', { pageId: docName.split(':')[1] })
    e.chain().focus().insertContent({ type: 'secretBlock', attrs: { id } }).run()
  }

  const slash: Slash[] = [
    { label: 'Título', hint: 'Seção grande', run: (e) => void e.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Subtítulo', hint: 'Seção menor', run: (e) => void e.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: 'Lista', hint: 'Com marcadores', run: (e) => void e.chain().focus().toggleBulletList().run() },
    { label: 'Lista numerada', hint: '1, 2, 3', run: (e) => void e.chain().focus().toggleOrderedList().run() },
    { label: 'Tabela', hint: '3 × 3', run: (e) => void e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { label: 'Citação', hint: 'Fala ou trecho', run: (e) => void e.chain().focus().toggleBlockquote().run() },
    { label: 'Divisor', hint: 'Linha horizontal', run: (e) => void e.chain().focus().setHorizontalRule().run() },
    { label: 'Destaque', hint: 'Caixa com ícone (callout)', run: (e) => void e.chain().focus().insertContent({ type: 'callout', content: [{ type: 'paragraph' }] }).run() },
    { label: 'Imagem', hint: 'Enviar do computador', run: (e) => pickImages((files) => addImages(e.view, files)) },
    { label: 'Link para página', hint: 'Ou digite [[', run: (e) => void e.chain().focus().insertContent('[[').run() },
    ...(nested ? [] : [{ label: 'Bloco secreto', hint: 'Só o mestre (e quem ele marcar) vê', gm: true, run: addSecret }]),
  ]

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({ undoRedo: false, link: { openOnClick: true, autolink: true } }),
      Collaboration.configure({ document: ydoc }),
      CollaborationCaret.configure({ provider, user: { name: me.name, color: colorOf(me.id) } }),
      TableKit.configure({ table: { resizable: true } }),
      Image,
      Placeholder.configure({ placeholder: placeholder ?? 'Escreva, ou digite / para inserir blocos' }),
      Callout, PageLink, ...(nested ? [] : [SecretBlock]),
      suggestion<Slash>('slash', '/', (q) => slash.filter((s) => (!s.gm || isGm) && s.label.toLowerCase().includes(q.toLowerCase())),
        (e, range, item) => { e.chain().focus().deleteRange(range).run(); void item.run(e) }, ui),
      // [[ abre a busca de páginas (W4); o mestre também pode criar a página na hora.
      suggestion<PageNode | { create: string }>('pagelink', '[[', (q) => {
        const found: (PageNode | { create: string })[] = pagesRef.current.filter((p) => p.title.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
        return isGm && q.trim() && !found.some((p) => 'title' in p && p.title.toLowerCase() === q.trim().toLowerCase()) ? [...found, { create: q.trim() }] : found
      }, async (e, range, item) => {
        const id = 'create' in item ? (await request<{ id: string }>(socket, 'page:create', { title: item.create, kind: 'text' })).id : item.id
        e.chain().focus().deleteRange(range).insertContent([{ type: 'pageLink', attrs: { id } }, { type: 'text', text: ' ' }]).run()
      }, ui),
    ],
    editorProps: {
      attributes: { class: `wiki-prose ${nested ? 'min-h-8' : 'min-h-[50vh]'}` },
      handlePaste: (view, e) => {
        // Word e Excel copiam texto junto com um print dele: nesse caso vale o texto.
        const files = imagesIn(e.clipboardData?.files)
        if (!files.length || e.clipboardData?.getData('text/plain')) return false
        void addImages(view, files)
        return true
      },
      handleDrop: (view, e, _slice, moved) => {
        const files = imagesIn(e.dataTransfer?.files)
        if (moved || !files.length) return false
        const at = view.posAtCoords({ left: e.clientX, top: e.clientY })
        if (at) view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(at.pos))))
        void addImages(view, files)
        return true
      },
    },
  }, [ydoc, provider, editable])

  useEffect(() => { if (editor && onReady) onReady(editor, provider) }, [editor, provider, onReady])

  return (
    <div className="relative">
      {editable && (
        <div className="mb-2 flex items-center gap-2">
          <button type="button" className="btn btn-ghost px-2 py-1 text-xs text-muted" onClick={() => pickImages((files) => editor && addImages(editor.view, files))}>
            <ImagePlus size={14} /> {t('addImage')}
          </button>
          {isGm && !nested && (
            <button type="button" className="btn btn-ghost px-2 py-1 text-xs text-muted" onClick={() => editor && addSecret(editor).catch((e: Error) => setError(e.message))}>
              <Lock size={14} /> {t('addSecret')}
            </button>
          )}
          {error && <p role="alert" className="text-xs text-fumble">{error}</p>}
        </div>
      )}
      <EditorContent editor={editor} />
      {menu?.rect && menu.items.length > 0 && (
        <ul role="listbox" className="card fixed z-50 max-h-72 w-72 overflow-y-auto p-1 text-sm shadow-xl" style={{ top: menu.rect.bottom + 4, left: menu.rect.left }}>
          {menu.items.map((it, i) => (
            <li key={i} role="option" aria-selected={i === sel}>
              <button className={`w-full rounded px-2 py-1.5 text-left ${i === sel ? 'bg-bg' : ''}`} onMouseDown={(e) => { e.preventDefault(); menu.select(it) }}>
                {'label' in it ? <><span className="font-medium">{it.label}</span> <span className="text-xs text-muted">{it.hint}</span></> : 'create' in it ? <>Criar página <b>{it.create}</b></> : it.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const imagesIn = (files?: FileList | null) => [...(files ?? [])].filter((f) => f.type.startsWith('image/'))

function pickImages(onPick: (files: File[]) => void) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true })
  input.onchange = () => onPick(imagesIn(input.files))
  input.click()
}
