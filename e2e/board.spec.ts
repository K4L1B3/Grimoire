import { test, expect } from '@playwright/test'
import { captureFrames, createCampaign, dragFromLibrary, fixture, rawSocket, signUp } from './helpers'

test('tabuleiro: token, camada do mestre, pin, combate e troca de cena', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id, invite } = await createCampaign(gm)
  const player = await signUp(browser, 'Jogadora')
  const frames = captureFrames(player)
  await player.goto(invite)

  // Personagem da jogadora e um vilão do mestre.
  await gm.goto(`/c/${id}/sheets`)
  for (const [name, owner] of [['Lyra', true], ['Vilao', false]] as const) {
    await gm.getByRole('button', { name: 'Novo personagem' }).click()
    await gm.getByLabel('Nome', { exact: true }).fill(name)
    if (owner) await gm.getByRole('checkbox', { name: 'Jogadora' }).check()
    await gm.getByRole('button', { name: 'Criar', exact: true }).click()
    await gm.waitForURL(/\/sheets\/[^/]+$/)
    await gm.goto(`/c/${id}/sheets`)
  }

  await gm.goto(`/c/${id}/play`)
  await expect(gm.getByTestId('board').locator('canvas')).toBeVisible({ timeout: 30_000 })
  // Mestre arrasta da biblioteca: personagem de jogador e criatura (o vilão não tem dono).
  await dragFromLibrary(gm, 'Personagens', 'Lyra', 300, 250)
  await dragFromLibrary(gm, 'Criaturas', 'Vilao', 400, 250)

  await player.goto(`/c/${id}/play`)
  await expect.poll(() => frames.some((f) => f.includes('"name":"Lyra"'))).toBe(true)
  await expect.poll(() => frames.some((f) => f.includes('"name":"Vilao"'))).toBe(true)

  // Jogadora não move o token do vilão (servidor recusa).
  const s = await rawSocket(player, id)
  const snap = await s.emitWithAck('scene:join', {})
  const vilao = snap.data.tokens.find((t: { name: string }) => t.name === 'Vilao')
  const lyra = snap.data.tokens.find((t: { name: string }) => t.name === 'Lyra')
  expect((await s.emitWithAck('token:move', { id: vilao.id, x: 0, y: 0 })).ok).toBe(false)
  expect((await s.emitWithAck('token:move', { id: lyra.id, x: 70, y: 70 })).ok).toBe(true)
  expect((await s.emitWithAck('token:create', { sceneId: snap.data.scene.id, x: 0, y: 0 })).ok).toBe(false)

  // Efeitos: a dona marca o próprio token, mas não o do vilão.
  expect((await s.emitWithAck('token:effect', { id: vilao.id, name: 'envenenado' })).ok).toBe(false)
  expect((await s.emitWithAck('token:effect', { id: lyra.id, name: 'envenenado' })).ok).toBe(true)
  const conditions = async () => (await s.emitWithAck('scene:join', {})).data.tokens.find((t: { id: string }) => t.id === lyra.id).conditions
  expect(await conditions()).toEqual(['envenenado'])
  expect((await s.emitWithAck('token:effect', { id: lyra.id, name: 'envenenado' })).ok).toBe(true)
  expect(await conditions()).toEqual([])

  // Mestre esconde o vilão na camada do mestre: some da rede da jogadora.
  const gs = await rawSocket(gm, id)
  await gs.emitWithAck('scene:join', {})
  expect((await gs.emitWithAck('token:update', { id: vilao.id, patch: { layer: 'gm' } })).ok).toBe(true)
  await expect.poll(() => frames.some((f) => f.includes('token:sync') && f.includes(vilao.id) && f.includes('remove'))).toBe(true)
  const before = frames.length
  await gs.emitWithAck('token:update', { id: vilao.id, patch: { name: 'Segredo do mestre' } })
  await gm.waitForTimeout(500)
  expect(frames.slice(before).some((f) => f.includes('Segredo do mestre'))).toBe(false)

  // Pin só do mestre não trafega; revelado, aparece para a jogadora (P5, P7).
  const pin = await gs.emitWithAck('pin:create', { sceneId: snap.data.scene.id, x: 0.5, y: 0.5, label: 'Armadilha' })
  await gm.waitForTimeout(500)
  expect(frames.some((f) => f.includes('Armadilha'))).toBe(false)
  await gs.emitWithAck('pin:update', { id: pin.data.id, patch: { visibility: 'all' } })
  await expect(player.getByRole('button', { name: 'Armadilha' })).toBeVisible()

  // Combate: NPC com vida "só estado" — jogadora vê o rótulo, nunca o número (C6).
  await gm.getByRole('button', { name: 'Combate', exact: true }).click()
  await gm.getByLabel('Nome do NPC').fill('Goblin')
  await gm.getByLabel('Vida do NPC').fill('7')
  await gm.getByLabel('Adicionar NPC').click()
  await gm.getByLabel('Dano ou cura em Goblin').fill('-4')
  await gm.getByLabel('Dano ou cura em Goblin').press('Enter')
  await player.getByRole('button', { name: 'Combate', exact: true }).click()
  await expect(player.getByText('muito ferido')).toBeVisible()
  expect(frames.some((f) => f.includes('combat:state') && /"hp":3\b/.test(f))).toBe(false)
  await gm.getByRole('button', { name: 'Próximo turno' }).click()
  await expect(gm.getByText('Rodada 2')).toBeVisible()

  // Trocar de cena leva a jogadora junto (T2).
  const closeBtn = gm.getByRole('button', { name: 'Fechar janela' })
  while (await closeBtn.count()) await closeBtn.first().dispatchEvent('click')
  await gm.getByRole('button', { name: 'mapa', exact: true }).click()
  await gm.locator('div.card input[type=file]').setInputFiles(fixture('mapa.png'))
  await expect(gm.getByRole('button', { name: 'Ativar' })).toBeVisible({ timeout: 20_000 })
  const f2 = frames.length
  await gm.getByRole('button', { name: 'Ativar' }).click()
  await expect.poll(() => frames.slice(f2).some((f) => f.includes('scene:activated'))).toBe(true)
  s.close()
  gs.close()
})
