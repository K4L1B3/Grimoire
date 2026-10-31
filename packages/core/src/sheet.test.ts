import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FieldsSchema, fieldMap, reconcileValues, slugify, tabOrder, uniqueName } from './sheet.ts'

test('nome sugerido a partir do rótulo do PDF', () => {
  assert.equal(slugify('Força'), 'forca')
  assert.equal(slugify('PV Máximo:'), 'pv_maximo')
  assert.equal(slugify('2ª Arma'), '_2_arma')
  assert.equal(uniqueName('forca', ['forca', 'forca_2']), 'forca_3')
})

test('nomes repetidos são recusados', () => {
  const f = { id: 'a', name: 'forca', type: 'number' as const, page: 0, x: 0, y: 0, w: 0.1, h: 0.1 }
  assert.equal(FieldsSchema.safeParse([f, { ...f, id: 'b' }]).success, false)
  assert.equal(FieldsSchema.safeParse([f, { ...f, id: 'b', name: 'Força' }]).success, false)
})

test('mapa de campos mostra dependentes e erro de sintaxe', () => {
  const { dependents, syntax } = fieldMap([{ name: 'forca' }, { name: 'mod', formula: 'floor((forca-10)/2)' }, { name: 'ruim', formula: 'forca +' }])
  assert.deepEqual(dependents.get('forca'), ['mod'])
  assert.ok(syntax.ruim)
})

test('Tab segue linhas e colunas', () => {
  const order = tabOrder([{ id: 'c', page: 0, x: 0.1, y: 0.5 }, { id: 'b', page: 0, x: 0.6, y: 0.2 }, { id: 'a', page: 0, x: 0.1, y: 0.205 }, { id: 'd', page: 1, x: 0, y: 0 }])
  assert.deepEqual(order.map((f) => f.id), ['a', 'b', 'c', 'd'])
})

test('campo removido guarda o valor por 30 dias', () => {
  const day = 24 * 3600 * 1000
  const v1 = reconcileValues({ forca: 16, sorte: 3 }, new Set(['forca']), 0)
  assert.deepEqual(v1, { forca: 16, __removed: { sorte: { v: 3, at: 0 } } })
  assert.deepEqual(reconcileValues(v1, new Set(['forca', 'sorte']), 10 * day), { forca: 16, sorte: 3 })
  assert.deepEqual(reconcileValues(v1, new Set(['forca']), 31 * day), { forca: 16 })
})
