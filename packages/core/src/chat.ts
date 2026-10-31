// Comandos e visibilidade do chat (SDD D3, D6). Puro: o realtime decide quem recebe o quê com estas funções.
import type { Member, RollVisibility } from './permissions.ts'
import type { RollResult } from './dice.ts'

export type Command =
  | { kind: 'roll'; formula: string; label?: string }
  | { kind: 'whisper'; to: string; text: string }
  | { kind: 'text'; text: string }

// "/r 1d20+2 # Ataque" rola com rótulo; "/w Ana oi" sussurra; o resto é texto.
export function parseCommand(input: string): Command {
  const s = input.trim()
  const r = /^\/(?:r|roll)\s+([^#]+?)\s*(?:#\s*(.*))?$/i.exec(s)
  if (r) return { kind: 'roll', formula: r[1]!, label: r[2] || undefined }
  const w = /^\/w\s+(?:"([^"]+)"|(\S+))\s+([\s\S]+)$/i.exec(s)
  if (w) return { kind: 'whisper', to: (w[1] ?? w[2])!, text: w[3]! }
  return { kind: 'text', text: s }
}

export type Message = {
  id: string
  authorId: string
  authorName: string
  /** Foto de perfil de quem escreveu. */
  authorImage?: string | null
  actorName?: string | null
  text?: string | null
  label?: string | null
  roll?: RollResult | null
  visibility: RollVisibility
  toUserIds: string[]
  createdAt: string
  /** Cor do dado de quem rolou (D8). */
  color?: string
  /** Sai só no chat, sem dado 3D: várias rolagens de um clique não viram fila de animação. */
  quiet?: boolean
}

export type MessageView = Message | { id: string; authorId: string; authorName: string; authorImage?: string | null; createdAt: string; visibility: 'hidden'; hiddenRoll: true }

// O que um membro recebe de uma mensagem; null = não recebe nada (nem sabe que existe).
export function viewMessage(m: Message, viewer: Member): MessageView | null {
  if (viewer.role === 'gm' || m.authorId === viewer.userId) return m
  if (m.visibility === 'public') return m
  if (m.visibility === 'hidden') return { id: m.id, authorId: m.authorId, authorName: m.authorName, authorImage: m.authorImage, createdAt: m.createdAt, visibility: 'hidden', hiddenRoll: true }
  return m.toUserIds.includes(viewer.userId) ? m : null
}
