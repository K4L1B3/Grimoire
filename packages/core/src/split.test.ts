import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampPane } from './split.ts'

test('painel respeita mínimo e máximo sozinho', () => {
  assert.equal(clampPane(0.4, 0), 0.4)
  assert.equal(clampPane(0.01, 0), 0.15)
  assert.equal(clampPane(0.99, 0), 0.7)
})

test('dois painéis nunca tomam mais que 85% da mesa', () => {
  assert.ok(Math.abs(clampPane(0.5, 0.5) - 0.35) < 1e-9)
  assert.ok(clampPane(0.7, 0.7) + 0.7 <= 0.85 + 1e-9)
})
