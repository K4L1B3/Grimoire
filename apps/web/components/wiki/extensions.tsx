'use client'
// Extensões do editor da wiki: callout, link [[ ]] para página, bloco secreto e os menus de sugestão (/ e [[).
import { Extension, Node, mergeAttributes, type Editor, type Range } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import Link from 'next/link'
import { useWiki } from './context'
import { SecretView } from './secret'

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => ({ emoji: { default: '💡' } }),
  parseHTML: () => [{ tag: 'div[data-callout]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '', 'data-emoji': node.attrs.emoji, class: 'callout' }), 0],
})

// Link para página (W4): guarda só o id; o texto vem da árvore, então renomear a página atualiza o chip.
export const PageLink = Node.create({
  name: 'pageLink',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ id: { default: null } }),
  parseHTML: () => [{ tag: 'span[data-page-link]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-page-link': '' })],
  // O clique fica com o <Link>: se chegar ao ProseMirror, o openOnClick do link abre uma aba nova além de navegar.
  addNodeView: () => ReactNodeViewRenderer(PageChip, { stopEvent: ({ event }) => event.type === 'mousedown' }),
})

function PageChip({ node }: NodeViewProps) {
  const { byId, campaignId } = useWiki()
  const p = byId.get(node.attrs.id)
  return (
    <NodeViewWrapper as="span" className="mx-0.5">
      {p
        ? <Link href={`/c/${campaignId}/wiki/${p.id}`} className="rounded bg-accent/15 px-1 text-accent no-underline hover:bg-accent/25" contentEditable={false}>{p.title}</Link>
        : <span className="rounded bg-line px-1 text-muted" contentEditable={false}>página oculta</span>}
    </NodeViewWrapper>
  )
}

// Bloco secreto (W6, ADR-4): na página fica só o id; o conteúdo é outro documento que o servidor só entrega a quem pode ver.
export const SecretBlock = Node.create({
  name: 'secretBlock',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({ id: { default: null } }),
  parseHTML: () => [{ tag: 'div[data-secret]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-secret': '' })],
  addNodeView: () => ReactNodeViewRenderer(({ node, deleteNode, editor }: NodeViewProps) => (
    <NodeViewWrapper>
      <SecretView id={node.attrs.id} onRemove={editor.isEditable ? deleteNode : undefined} />
    </NodeViewWrapper>
  )),
})

export type MenuState<T> = { items: T[]; rect: DOMRect | null; select: (item: T) => void } | null

// Ponte entre o plugin de sugestão do TipTap e um menu em React (estado fica no componente do editor).
export function suggestion<T>(name: string, char: string, items: (q: string) => T[], run: (editor: Editor, range: Range, item: T) => void, ui: { set: (s: MenuState<T>) => void; key: (e: KeyboardEvent) => boolean }) {
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [Suggestion<T>({
        editor: this.editor,
        pluginKey: new PluginKey(name),
        char,
        allowSpaces: char === '[[',
        items: ({ query }) => items(query),
        command: ({ editor, range, props }) => run(editor, range, props),
        render: () => {
          const show = (p: SuggestionProps<T>) => ui.set({ items: p.items, rect: p.clientRect?.() ?? null, select: (it) => p.command(it) })
          return { onStart: show, onUpdate: show, onExit: () => ui.set(null), onKeyDown: ({ event }) => (event.key === 'Escape' ? (ui.set(null), true) : ui.key(event)) }
        },
      })]
    },
  })
}
