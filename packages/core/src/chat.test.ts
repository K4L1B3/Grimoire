import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCommand, viewMessage, type Message } from './chat.ts'

test('comandos', () => {
  assert.deepEqual(parseCommand('/r 1d20+@mod_forca # Ataque espada'), { kind: 'roll', formula: '1d20+@mod_forca', label: 'Ataque espada' })
  assert.deepEqual(parseCommand('/roll 2d6'), { kind: 'roll', formula: '2d6', label: undefined })
  assert.deepEqual(parseCommand('/w Ana cuidado com a porta'), { kind: 'whisper', to: 'Ana', text: 'cuidado com a porta' })
  assert.deepEqual(parseCommand('/w "Ana Maria" oi'), { kind: 'whisper', to: 'Ana Maria', text: 'oi' })
  assert.deepEqual(parseCommand('  olá mesa '), { kind: 'text', text: 'olá mesa' })
})

const base: Message = { id: '1', authorId: 'g', authorName: 'Mestre', visibility: 'public', toUserIds: [], createdAt: '' }
const gm = { userId: 'g', role: 'gm' as const }
const p = { userId: 'p', role: 'player' as const }
const q = { userId: 'q', role: 'player' as const }

test('rolagem oculta: jogador só sabe que o mestre rolou', () => {
  const m = { ...base, visibility: 'hidden' as const, roll: { formula: '1d20', terms: [], total: 17, crit: false, fumble: false } }
  const v = viewMessage(m, p)!
  assert.ok('hiddenRoll' in v)
  assert.equal(JSON.stringify(v).includes('17'), false)
  assert.equal(viewMessage(m, gm), m)
})

test('privada e sussurro: só autor, mestre e destinatários', () => {
  const m = { ...base, authorId: 'p', visibility: 'private' as const, toUserIds: ['q'] }
  assert.equal(viewMessage(m, p), m)
  assert.equal(viewMessage(m, gm), m)
  assert.equal(viewMessage(m, q), m)
  assert.equal(viewMessage(m, { userId: 'r', role: 'player' }), null)
})
