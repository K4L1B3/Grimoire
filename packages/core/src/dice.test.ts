import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roll, DiceError, type Rng } from './dice.ts'

// RNG que devolve a sequência dada, para testes determinísticos
const seq = (...vals: number[]): Rng => () => {
  const v = vals.shift()
  if (v === undefined) throw new Error('sequência acabou')
  return v
}

test('soma simples com modificador: 2d6+3', () => {
  const r = roll('2d6+3', {}, seq(4, 5))
  assert.equal(r.total, 12)
})

test('referência a campo: 1d20 + @mod_forca', () => {
  const r = roll('1d20 + @mod_forca', { mod_forca: 3 }, seq(10))
  assert.equal(r.total, 13)
  assert.deepEqual(r.terms[1], { kind: 'ref', sign: 1, name: 'mod_forca', value: 3 })
})

test('campo de outra ficha do ator: @companheiro.forca', () => {
  assert.equal(roll('d4+@companheiro.forca', { 'companheiro.forca': 2 }, seq(1)).total, 3)
})

test('manter maiores: 4d6kh3', () => {
  const r = roll('4d6kh3', {}, seq(2, 6, 1, 5))
  assert.equal(r.total, 13)
  const t = r.terms[0]!
  assert.ok(t.kind === 'dice')
  assert.deepEqual(t.dice.filter((d) => d.dropped).map((d) => d.value), [1])
})

test('desvantagem: 2d20kl1 e crítico/falha', () => {
  const r = roll('2d20kl1', {}, seq(20, 1))
  assert.equal(r.total, 1)
  assert.equal(r.fumble, true)
  assert.equal(r.crit, false, 'o 20 descartado não conta como crítico')
  assert.equal(roll('1d20', {}, seq(20)).crit, true)
})

test('explosivo: 1d6!', () => {
  const r = roll('1d6!', {}, seq(6, 6, 2))
  assert.equal(r.total, 14)
  const t = r.terms[0]!
  assert.ok(t.kind === 'dice' && t.dice.length === 3 && t.dice[2]!.exploded)
})

test('sucessos: 3d6>=5', () => {
  assert.equal(roll('3d6>=5', {}, seq(5, 2, 6)).total, 2)
})

test('subtração e número negativo', () => {
  assert.equal(roll('-2 + 1d4 - 1', {}, seq(3)).total, 0)
})

test('rng real fica dentro do intervalo', () => {
  for (let i = 0; i < 200; i++) {
    const t = roll('1d6').total
    assert.ok(t >= 1 && t <= 6)
  }
})

test('entradas inválidas dão erro claro', () => {
  const cases: [string, RegExp][] = [
    ['', /vazia/],
    ['abc', /Não entendi/],
    ['1d20 2', /Não entendi/],
    ['1d20+', /Não entendi/],
    ['0d6', /entre 1 e 100 dados/],
    ['1d1', /entre 2 e 1000 lados/],
    ['2d6kh3', /manter 3 de 2/],
    ['1d20+@nada', /@nada não existe/],
  ]
  for (const [f, msg] of cases) assert.throws(() => roll(f, {}, () => 1), (e) => e instanceof DiceError && msg.test(e.message), f)
  assert.throws(() => roll('1d2!', {}, () => 2), /Explosões demais/)
})
