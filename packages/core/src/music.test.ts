import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_MIX, mixLayers, musicPosition, type SoundMix } from './music.ts'

const a = { id: 'a', duration: 100 }, b = { id: 'b', duration: 50 }, rain = { id: 'rain', duration: 60 }
const known = new Map([a, b, rain].map((t) => [t.id, t]))
const mix = (m: Partial<SoundMix>): SoundMix => ({ ...DEFAULT_MIX, tracks: { ...DEFAULT_MIX.tracks, exploration: ['a', 'b'] }, ...m })

test('acha a faixa e a posição pelo tempo decorrido', () => {
  assert.deepEqual(musicPosition([a, b], 0), { index: 0, offset: 0 })
  assert.deepEqual(musicPosition([a, b], 99), { index: 0, offset: 99 })
  assert.deepEqual(musicPosition([a, b], 120), { index: 1, offset: 20 })
})

test('a playlist volta ao começo', () => {
  assert.deepEqual(musicPosition([a, b], 310), { index: 0, offset: 10 })
})

test('playlist sem duração não toca', () => {
  assert.equal(musicPosition([], 10), null)
  assert.equal(musicPosition([{ id: 'x', duration: 0 }], 10), null)
})

test('música e ambientes viram camadas simultâneas', () => {
  const layers = mixLayers(mix({ mood: 'exploration', intensity: 3, levels: { rain: 2 }, startedAt: 1000 }), known, 11_000)
  assert.deepEqual(layers, [
    { key: 'music:exploration', tracks: [a, b], gain: 1, elapsed: 10 },
    { key: 'rain', tracks: [rain], gain: 0.65, elapsed: 0 },
  ])
})

test('intensidade muda só o ganho da música', () => {
  assert.equal(mixLayers(mix({ mood: 'exploration', intensity: 0 }), known, 0)[0]!.gain, 0.3)
})

test('estado sem faixas não cria camada de música', () => {
  assert.deepEqual(mixLayers(mix({ mood: 'combat' }), known, 0), [])
  assert.deepEqual(mixLayers(mix({ mood: null }), known, 0), [])
})

test('pausar cala tudo sem esquecer a mixagem', () => {
  assert.deepEqual(mixLayers(mix({ mood: 'exploration', levels: { rain: 1 }, paused: true }), known, 0), [])
})

test('som apagado some da mixagem', () => {
  const layers = mixLayers(mix({ mood: 'exploration', levels: { gone: 3 }, tracks: { ...DEFAULT_MIX.tracks, exploration: ['gone', 'b'] } }), known, 0)
  assert.deepEqual(layers.map((l) => l.tracks.map((t) => t.id)), [['b']])
})
