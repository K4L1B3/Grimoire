import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noteShelf } from './notes.ts'

const p = (id: string, kind: string, parentId: string | null = null, extra: { inNotes?: boolean; ownerId?: string } = {}) => ({ id, kind, parentId, ownerId: extra.ownerId ?? null, inNotes: extra.inNotes ?? false })

test('pasta em Notas leva junto o que está dentro, em qualquer nível', () => {
  const { folders, notes } = noteShelf([
    p('lore', 'folder', null, { inNotes: true }), p('povos', 'folder', 'lore'), p('elfos', 'text', 'povos'), p('mapa', 'map', 'lore'), p('sub', 'text', 'elfos'),
  ])
  assert.deepEqual(folders.map((f) => [f.page.id, f.parentId]), [['lore', null], ['povos', 'lore']])
  assert.deepEqual(notes.map((n) => [n.page.id, n.folderId]), [['elfos', 'povos'], ['mapa', 'lore'], ['sub', 'povos']])
})

test('fora de Notas continua fora: pasta sem indicação, quadro e página solta', () => {
  const { folders, notes } = noteShelf([p('x', 'folder'), p('y', 'text', 'x'), p('z', 'text'), p('lore', 'folder', null, { inNotes: true }), p('q', 'board', 'lore')])
  assert.deepEqual(folders.map((f) => f.page.id), ['lore'])
  assert.deepEqual(notes, [])
})

test('página indicada sem pasta da mesa fica na raiz, mesmo dentro de pasta comum', () => {
  const { notes } = noteShelf([p('x', 'folder'), p('y', 'text', 'x', { inNotes: true }), p('solta', 'text', null, { inNotes: true })])
  assert.deepEqual(notes.map((n) => n.folderId), [null, null])
})

test('nota pessoal entra sem indicação', () => {
  assert.deepEqual(noteShelf([p('d', 'text', null, { ownerId: 'u1' })]).notes.map((n) => n.folderId), [null])
})

test('jogador sem a pasta oculta: conteúdo indicado cai na raiz e o resto some', () => {
  const { folders, notes } = noteShelf([p('a', 'text', 'oculta', { inNotes: true }), p('b', 'text', 'oculta')])
  assert.deepEqual(folders, [])
  assert.deepEqual(notes.map((n) => [n.page.id, n.folderId]), [['a', null]])
})
