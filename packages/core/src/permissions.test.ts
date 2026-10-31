import { test } from 'node:test'
import assert from 'node:assert/strict'
import { can, type Member } from './permissions.ts'

const gm: Member = { userId: 'g', role: 'gm' }
const pl: Member = { userId: 'p', role: 'player' }
const ob: Member = { userId: 'o', role: 'observer' }

test('fora da campanha não pode nada', () => {
  assert.equal(can(null, 'page.view', { visibility: 'visible' }), false)
})

test('páginas da wiki', () => {
  for (const v of ['hidden', 'visible', 'editable'] as const) assert.equal(can(gm, 'page.edit', { visibility: v }), true)
  for (const kind of ['board', 'timeline']) assert.equal(can(pl, 'page.edit', { visibility: 'editable', kind }), true)
  // Nota da wiki é só leitura para o jogador, mesmo marcada como editável.
  for (const kind of ['text', 'map', undefined]) assert.equal(can(pl, 'page.edit', { visibility: 'editable', kind }), false)
  assert.equal(can(pl, 'page.edit', { visibility: 'visible', kind: 'board' }), false)
  assert.equal(can(ob, 'page.edit', { visibility: 'editable', kind: 'board' }), false)
  assert.equal(can(pl, 'page.view', { visibility: 'hidden' }), false)
  assert.equal(can(ob, 'page.view', { visibility: 'visible' }), true)
})

test('nota pessoal: só o dono, em qualquer papel, nem o mestre', () => {
  for (const a of ['page.view', 'page.edit'] as const) {
    assert.equal(can(gm, a, { visibility: 'editable', ownerId: 'p' }), false)
    assert.equal(can(pl, a, { visibility: 'hidden', ownerId: 'p' }), true)
    assert.equal(can(pl, a, { visibility: 'editable', ownerId: 'x' }), false)
    assert.equal(can(ob, a, { visibility: 'hidden', ownerId: 'o' }), true)
  }
})

test('blocos secretos', () => {
  assert.equal(can(gm, 'secret.view', { visibleTo: [] }), true)
  assert.equal(can(pl, 'secret.view', { visibleTo: ['p'] }), true)
  assert.equal(can(pl, 'secret.view', { visibleTo: ['x'] }), false)
  assert.equal(can(ob, 'secret.view', { visibleTo: ['o'] }), false)
})

test('molde de ficha, cena, camada do mestre e névoa são só do mestre', () => {
  for (const a of ['template.edit', 'scene.edit', 'gmLayer.view', 'fog.bypass'] as const) {
    assert.equal(can(gm, a, null), true)
    assert.equal(can(pl, a, null), false)
    assert.equal(can(ob, a, null), false)
  }
})

test('fichas e tokens: mestre todos, jogador só os seus', () => {
  for (const a of ['sheet.edit', 'token.move'] as const) {
    assert.equal(can(gm, a, { ownerIds: [] }), true)
    assert.equal(can(pl, a, { ownerIds: ['p'] }), true)
    assert.equal(can(pl, a, { ownerIds: ['x'] }), false)
    assert.equal(can(ob, a, { ownerIds: ['o'] }), false)
  }
})

test('rolagens', () => {
  for (const v of ['public', 'hidden', 'private'] as const) assert.equal(can(gm, 'roll', { visibility: v }), true)
  assert.equal(can(pl, 'roll', { visibility: 'public' }), true)
  assert.equal(can(pl, 'roll', { visibility: 'private' }), true)
  assert.equal(can(pl, 'roll', { visibility: 'hidden' }), false)
  assert.equal(can(ob, 'roll', { visibility: 'public' }), false)
})
