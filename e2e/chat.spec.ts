import { test, expect } from '@playwright/test'
import { createCampaign, signUp } from './helpers'

test('rolagens: pública, oculta do mestre e sussurro', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id, invite } = await createCampaign(gm)
  const player = await signUp(browser, 'Jogadora')
  // Guarda tudo que chega pelo socket do jogador, para provar que o número oculto não trafega.
  const frames: string[] = []
  player.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))))
  await player.goto(invite)
  await player.waitForURL(new RegExp(`/c/${id}/play`))
  await gm.reload()

  const gmInput = gm.getByLabel('Mensagem ou rolagem')
  await gmInput.fill('/r 4d6kh3 # Atributo')
  await gmInput.press('Enter')
  await expect(player.getByText('Atributo')).toBeVisible()

  await gm.getByLabel('Quem vê').selectOption('hidden')
  await gmInput.fill('/r 1d20+1000 # Segredo')
  await gmInput.press('Enter')
  await expect(gm.getByText('Segredo')).toBeVisible()
  await expect(player.getByText('Mestre rolou dados em segredo.')).toBeVisible()
  expect(frames.some((f) => f.includes('Atributo'))).toBe(true) // a captura funciona
  expect(frames.some((f) => f.includes('Segredo') || /"total":10[0-2]\d/.test(f))).toBe(false)

  await gm.getByLabel('Quem vê').selectOption('public')
  await gmInput.fill('/w Jog a porta está trancada')
  await gmInput.press('Enter')
  await expect(player.getByText('a porta está trancada')).toBeVisible()
  await expect(player.getByText('sussurro para você')).toBeVisible()

  const pInput = player.getByLabel('Mensagem ou rolagem')
  await pInput.fill('/r 1d20 + banana')
  await pInput.press('Enter')
  await expect(player.getByText(/Não entendi a rolagem/)).toBeVisible()
})
