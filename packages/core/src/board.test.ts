import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyHp, cells, effectOf, mergeConditions, nextTurn, pinVisible, prevTurn, reorder, shuffle, snap, sortByInit, toggleEffect, tokenVisible, viewCombat, type Combat, type Combatant } from './board.ts'

const gm = { userId: 'g', role: 'gm' as const }
const pl = { userId: 'p', role: 'player' as const }

test('encaixe e distância no grid', () => {
  assert.equal(snap(100, 70, 0), 70)
  assert.equal(snap(110, 70, 5), 145)
  const g = { size: 70, diagonal: '1:1' as const }
  assert.equal(cells(0, 0, 210, 70, g), 3)
  assert.equal(cells(0, 0, 280, 280, { size: 70, diagonal: '5-10-5' }), 6)
})

const c = (id: string, p: Partial<Combatant> = {}): Combatant => ({ id, name: id, init: 10, hpMode: 'exact', hidden: false, conditions: [], moved: 0, ...p })

test('efeitos do token e do combate se somam sem repetir', () => {
  assert.deepEqual(mergeConditions(['cego', 'Caído'], [{ name: 'caído', rounds: 2 }]), [{ name: 'caído', rounds: 2 }, { name: 'cego' }])
})

test('efeitos: leitura do token e ligar/desligar sem duplicar o que veio do combate', () => {
  assert.equal(effectOf('envenenado').effect?.icon, 'biohazard')
  assert.deepEqual([effectOf('Envenenado (3)').name, effectOf('Envenenado (3)').rounds, effectOf('Envenenado (3)').effect?.name], ['Envenenado', '3', 'envenenado'])
  assert.equal(effectOf('maldição do lich').effect, undefined)

  assert.deepEqual(toggleEffect('cego', [], null, 't').conditions, ['cego'])
  assert.deepEqual(toggleEffect('cego', ['cego', 'caído'], null, 't').conditions, ['caído'])
  const combat: Combat = { round: 1, turn: 0, combatants: [c('a', { tokenId: 't', conditions: [{ name: 'Envenenado', rounds: 3 }] }), c('b', { tokenId: 'u', conditions: [{ name: 'envenenado' }] })] }
  const off = toggleEffect('envenenado', [], combat, 't')
  assert.deepEqual(off.conditions, [])
  assert.deepEqual(off.combat!.combatants.map((x) => x.conditions.length), [0, 1])
})

test('turnos, rodadas e condições que vencem sozinhas', () => {
  let s: Combat = { round: 1, turn: 0, combatants: sortByInit([c('a', { init: 5 }), c('b', { init: 18, conditions: [{ name: 'envenenado', rounds: 1 }, { name: 'caído' }] })]) }
  assert.equal(s.combatants[0]!.id, 'b')
  s = nextTurn(s)
  assert.equal(s.turn, 1)
  s = nextTurn(s)
  assert.deepEqual([s.round, s.turn], [2, 0])
  assert.deepEqual(s.combatants[0]!.conditions, [{ name: 'caído' }])
  assert.deepEqual([prevTurn(s).round, prevTurn(s).turn], [1, 1])
})

test('voltar turno devolve deslocamento e condições, mesmo se o mestre mexeu depois', () => {
  let s: Combat = { round: 1, turn: 0, combatants: [c('a', { moved: 3, conditions: [{ name: 'cego', rounds: 2 }] }), c('b', { moved: 0, conditions: [{ name: 'envenenado', rounds: 1 }, { name: 'caído' }] })] }
  s = nextTurn(s)
  assert.equal(s.combatants[0]!.moved, 0)
  assert.deepEqual([prevTurn(s).turn, prevTurn(s).combatants[0]!.moved], [0, 3])
  s.combatants[1]!.moved = 2
  s = nextTurn(s)
  assert.deepEqual(s.combatants.map((x) => x.conditions), [[{ name: 'cego', rounds: 1 }], [{ name: 'caído' }]])
  // Efeito posto depois da virada: voltar e avançar de novo recai na mesma duração.
  s.combatants[0]!.conditions.push({ name: 'lento', rounds: 3 })
  const back = prevTurn(s)
  assert.deepEqual([back.round, back.turn, back.combatants[1]!.moved], [1, 1, 2])
  assert.deepEqual(back.combatants[0]!.conditions, [{ name: 'cego', rounds: 2 }, { name: 'lento', rounds: 4 }])
  assert.deepEqual(back.combatants[1]!.conditions, [{ name: 'caído' }, { name: 'envenenado', rounds: 1 }])
  assert.deepEqual(nextTurn(back).combatants[0]!.conditions, s.combatants[0]!.conditions)
  // Sem histórico (combate antigo ou além do limite), volta só a vez.
  assert.deepEqual([prevTurn({ ...s, undo: undefined }).round, prevTurn({ ...s, undo: undefined }).combatants[0]!.conditions.length], [1, 2])
  assert.equal(prevTurn({ round: 1, turn: 0, combatants: [c('a')] }).turn, 0)
})

test('reordenar mantém a vez; antes do primeiro turno passar, começa quem ficou no topo', () => {
  const list = [c('a', { init: 5 }), c('b', { init: 3 })], late = c('novo', { init: 20 })
  const mid: Combat = { round: 2, turn: 1, combatants: list }
  const after = reorder(mid, sortByInit([...list, late]))
  assert.deepEqual([after.combatants[after.turn]!.id, after.turn], ['b', 2])
  assert.equal(reorder({ ...mid, round: 1, turn: 0 }, sortByInit([...list, late])).turn, 0)
})

test('empate segue a ordem da lista, que o sorteio embaralha', () => {
  const list = [c('a', { init: 7 }), c('b', { init: 7 }), c('c', { init: 9 })]
  assert.deepEqual(sortByInit(list).map((x) => x.id), ['c', 'a', 'b'])
  const seq = [2, 1]
  assert.deepEqual(shuffle(['a', 'b', 'c'], () => seq.shift()!), ['c', 'a', 'b'])
})

test('dano e cura', () => {
  assert.equal(applyHp(20, '-7'), 13)
  assert.equal(applyHp(18, '+5', 20), 20)
  assert.equal(applyHp(18, '12'), 12)
  assert.equal(applyHp(3, '-7'), 0) // PV não fica negativo
  assert.throws(() => applyHp(1, 'muito'))
})

test('vida oculta não manda número; inimigo oculto some para jogador', () => {
  const s: Combat = { round: 1, turn: 0, combatants: [c('orc', { hpMode: 'status' }), c('sombra', { hidden: true }), c('goblin', { hpMode: 'none' })] }
  const hp = () => ({ hp: 3, max: 10 })
  const v = viewCombat(s, pl, hp, () => false)
  assert.deepEqual(v.combatants.map((x) => x.id), ['orc', 'goblin'])
  assert.equal(v.combatants[0]!.status, 'muito ferido')
  assert.equal(JSON.stringify(v).includes('"hp":3'), false)
  assert.equal(viewCombat(s, gm, hp, () => false).combatants.length, 3)
  assert.equal(viewCombat(s, pl, hp, (x) => x.id === 'goblin').combatants[1]!.hp, 3)
  const ac = () => ({ ...hp(), ac: 15, dc: 13 })
  assert.equal(JSON.stringify(viewCombat({ ...s, combatants: s.combatants.map((x) => ({ ...x, hpMode: 'exact' as const, ac: 15, dc: 13 })) }, pl, ac, () => false)).match(/"(ac|dc)"/), null)
  assert.equal(viewCombat(s, gm, ac, () => false).combatants[0]!.ac, 15)
  assert.equal(viewCombat(s, pl, ac, (x) => x.id === 'goblin').combatants[1]!.ac, 15)
  assert.equal(viewCombat(s, pl, ac, (x) => x.id === 'goblin').combatants[1]!.dc, 13)
})

test('camada do mestre e pins só do mestre', () => {
  assert.equal(tokenVisible({ layer: 'gm' }, pl), false)
  assert.equal(tokenVisible({ layer: 'gm' }, gm), true)
  assert.equal(pinVisible({ visibility: 'gm', visibleTo: ['p'] }, pl), false)
  assert.equal(pinVisible({ visibility: 'some', visibleTo: ['p'] }, pl), true)
})
