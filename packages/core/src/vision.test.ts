import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellOf, cutWall, lineOfSight, moveBlocked, moveSegments, packBits, pointInPolygon, sightSegments, tokenLights, unpackBits, visibilityPolygon, visibleCells, type WallLike } from './vision.ts'

// Sala 1000×1000 com uma parede vertical em x=500 de y=0 a 800 (passagem embaixo).
const wall: WallLike = { points: [500, 0, 500, 800], kind: 'wall', state: null }
const door = (state: 'open' | 'closed' | 'locked'): WallLike => ({ points: [500, 800, 500, 1000], kind: 'door', state })
const win: WallLike = { points: [500, 800, 500, 1000], kind: 'window', state: null }

test('parede bloqueia visão e passagem; porta aberta não; janela só a passagem', () => {
  const sight = sightSegments([wall])
  assert.equal(lineOfSight(100, 100, 900, 100, sight), false)
  assert.equal(lineOfSight(100, 900, 900, 900, sight), true)
  assert.equal(moveBlocked(100, 900, 900, 900, moveSegments([wall, door('closed')])), true)
  assert.equal(moveBlocked(100, 900, 900, 900, moveSegments([wall, door('open')])), false)
  assert.equal(lineOfSight(100, 900, 900, 900, sightSegments([wall, win])), true)
  assert.equal(moveBlocked(100, 900, 900, 900, moveSegments([wall, win])), true)
})

test('polígono de visão não atravessa a parede', () => {
  const poly = visibilityPolygon(100, 100, sightSegments([wall]), 1000, 1000)
  assert.equal(pointInPolygon(poly, 300, 300), true)
  assert.equal(pointInPolygon(poly, 900, 100), false)
  assert.equal(pointInPolygon(poly, 600, 990), true) // visto pela passagem
})

test('no escuro só vê o que está iluminado ou na visão no escuro', () => {
  const sight = sightSegments([wall, door('closed')])
  const v = visibleCells(1000, 1000, sight, [{ x: 100, y: 100, vision: { range: 0, dark: 0 } }], [{ x: 300, y: 300, dim: 150 }], true)
  assert.equal(v.mask[cellOf(v, 300, 300)], 1)
  assert.equal(v.mask[cellOf(v, 100, 600)], 0)
  const dv = visibleCells(1000, 1000, sight, [{ x: 100, y: 100, vision: { range: 0, dark: 600 } }], [], true)
  assert.equal(dv.mask[cellOf(dv, 100, 600)], 1)
  assert.equal(dv.mask[cellOf(dv, 900, 100)], 0)
  const day = visibleCells(1000, 1000, sight, [{ x: 100, y: 100 }], [], false)
  assert.equal(day.mask[cellOf(day, 450, 950)], 1)
  assert.equal(day.mask[cellOf(day, 900, 900)], 0)
})

test('jogador enxerga quem carrega luz à vista, mas não atrás da parede nem pela luz do mestre', () => {
  const sight = sightSegments([wall, door('closed')])
  const me = [{ x: 100, y: 100, vision: { range: 0, dark: 0 } }]
  const torch = { bright: 100, dim: 200 }
  const friend = { x: 100, y: 700, layer: 'tokens', light: torch }, behind = { x: 900, y: 100, layer: 'tokens', light: torch }, hidden = { x: 300, y: 300, layer: 'gm', light: torch }
  const v = visibleCells(1000, 1000, sight, me, tokenLights([friend, behind, hidden]), true)
  assert.equal(v.mask[cellOf(v, 100, 700)], 1)
  assert.equal(v.mask[cellOf(v, 900, 100)], 0)
  assert.equal(v.mask[cellOf(v, 300, 300)], 0)
})

test('bits da névoa vão e voltam', () => {
  const m = new Uint8Array(20).map((_, i) => (i % 3 === 0 ? 1 : 0))
  assert.deepEqual(unpackBits(packBits(m), 20), m)
})

test('cutWall tira da parede o trecho sob a porta e devolve o que sobra', () => {
  const w = [0, 0, 1000, 0]
  assert.deepEqual(cutWall(w, { x: 300, y: 0 }, { x: 400, y: 0 }), [[0, 0, 300, 0], [400, 0, 1000, 0]])
  assert.deepEqual(cutWall(w, { x: 400, y: 0 }, { x: 300, y: 0 }), [[0, 0, 300, 0], [400, 0, 1000, 0]])
  assert.deepEqual(cutWall(w, { x: 0, y: 0 }, { x: 100, y: 0 }), [[100, 0, 1000, 0]]) // na ponta
  assert.deepEqual(cutWall(w, { x: 900, y: 0 }, { x: 1200, y: 0 }), [[0, 0, 900, 0]]) // passa da ponta
  assert.deepEqual(cutWall(w, { x: -10, y: 0 }, { x: 1010, y: 0 }), []) // cobre tudo
  assert.equal(cutWall(w, { x: 300, y: -50 }, { x: 300, y: 50 }), null) // cruza
  assert.equal(cutWall(w, { x: 1100, y: 0 }, { x: 1200, y: 0 }), null) // mesma reta, fora da parede
  assert.deepEqual(cutWall([0, 0, 300, 300], { x: 100, y: 100 }, { x: 200, y: 200 })!.length, 2) // diagonal
})
