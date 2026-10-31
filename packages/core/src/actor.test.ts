import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actorRefs } from './actor.ts'

test('ficha principal e companheiro', () => {
  const refs = actorRefs([
    { alias: null, fields: [{ name: 'forca' }, { name: 'mod_forca', formula: 'floor((forca-10)/2)' }, { name: 'ataque_lobo', formula: '@companheiro.mod_forca + 2' }], values: { forca: '16' } },
    { alias: 'companheiro', fields: [{ name: 'forca' }, { name: 'mod_forca', formula: 'floor((forca-10)/2)' }], values: { forca: 12 } },
  ])
  assert.equal(refs.mod_forca, 3)
  assert.equal(refs['companheiro.mod_forca'], 1)
  assert.equal(refs.ataque_lobo, 3)
})
