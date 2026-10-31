import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFormula, evaluate, dependencies, computeSheet, FormulaError } from './formula.ts'

const calc = (f: string, vars: Record<string, number> = {}) => evaluate(parseFormula(f), (n) => vars[n]!)

test('modificador de D&D', () => {
  assert.equal(calc('floor((forca-10)/2)', { forca: 15 }), 2)
  assert.equal(calc('floor((@forca-10)/2)', { forca: 8 }), -1)
})

test('precedência, unário e funções', () => {
  assert.equal(calc('2+3*4'), 14)
  assert.equal(calc('-(2+3)*2'), -10)
  assert.equal(calc('max(1, min(5, 3), ceil(1.2))'), 3)
  assert.equal(calc('@companheiro.forca + 1', { 'companheiro.forca': 4 }), 5)
})

test('dependências', () => {
  assert.deepEqual([...dependencies(parseFormula('floor((forca - 10)/2) + @nivel'))], ['forca', 'nivel'])
})

test('nada de eval: sintaxe fora da gramática é erro', () => {
  for (const f of ['process.exit()', 'forca;1', '2 +', '(1', '1)', 'alert(1)', '']) assert.throws(() => calc(f), FormulaError, f)
  assert.throws(() => calc('1/0'), /Divisão por zero/)
})

test('ficha calcula em cadeia e isola erros', () => {
  const r = computeSheet(
    [
      { name: 'forca' },
      { name: 'mod_forca', formula: 'floor((forca-10)/2)' },
      { name: 'ataque', formula: 'mod_forca + proficiencia' },
      { name: 'a', formula: 'b + 1' },
      { name: 'b', formula: 'a + 1' },
      { name: 'quebrado', formula: 'inexistente * 2' },
      { name: 'usa_quebrado', formula: 'quebrado + 1' },
    ],
    { forca: 16, proficiencia: 2 },
  )
  assert.equal(r.values.mod_forca, 3)
  assert.equal(r.values.ataque, 5)
  assert.match(r.errors.a!, /circular/)
  assert.match(r.errors.b!, /circular/)
  assert.match(r.errors.quebrado!, /inexistente/)
  assert.ok(r.errors.usa_quebrado)
  assert.equal('a' in r.values, false)
})
