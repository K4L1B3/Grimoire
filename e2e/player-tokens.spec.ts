import { test, expect, type Page } from '@playwright/test'
import { answer, createCampaign, dragFromLibrary, rawSocket, signUp } from './helpers'

const camera = (p: Page) => p.evaluate(() => {
  const b = (window as unknown as { __board: { app: { canvas: HTMLCanvasElement }; world: { x: number; y: number; scale: { x: number } } } }).__board
  const r = b.app.canvas.getBoundingClientRect()
  return { x: r.left + b.world.x, y: r.top + b.world.y, s: b.world.scale.x }
})

type Tk = { id: string; name: string; x: number; y: number; size: number; mine: boolean; layer: string; light: unknown }

test('jogador coloca o próprio token, configura e tira; o resto segue com o mestre', async ({ browser }) => {
  test.setTimeout(300_000) // Modo dev: três navegadores compilando sob demanda.
  const gm = await signUp(browser, 'Mestre')
  const { id, invite } = await createCampaign(gm)
  const player = await signUp(browser, 'Jogadora')
  await player.goto(invite)
  await player.waitForURL(/\/c\//)
  await player.goto(`/c/${id}/play`)
  await player.locator('[data-testid=board] canvas').waitFor({ timeout: 30_000 })

  const gs = await rawSocket(gm, id)
  const ps = await rawSocket(player, id)
  const sceneId = (await gs.emitWithAck('scene:join', {})).data.scene.id as string
  const tokens = async () => (await ps.emitWithAck('scene:join', {})).data.tokens as Tk[]
  const orc = (await gs.emitWithAck('token:create', { sceneId, name: 'Orc', x: 700, y: 700 })).data.id as string

  // Cria o personagem e arrasta da biblioteca.
  await player.getByRole('toolbar', { name: 'Biblioteca' }).getByRole('button', { name: 'Personagens' }).click()
  await player.getByRole('button', { name: 'Personagem', exact: true }).click()
  await answer(player, 'Aria')
  await expect(player.locator('li[data-tile]', { hasText: 'Aria' })).toBeVisible()
  await dragFromLibrary(player, 'Personagens', 'Aria', 200, 120)
  await expect.poll(async () => (await tokens()).filter((t) => t.mine).length, { timeout: 15_000 }).toBe(1)
  const tk = (await tokens()).find((t) => t.mine)!
  expect(tk.name).toBe('Aria')

  // Seleciona no mapa e edita pelo botão.
  await player.getByRole('button', { name: 'Fechar biblioteca' }).click()
  await player.getByRole('button', { name: 'Fechar janela' }).click() // a ficha abre sozinha ao criar o personagem
  await player.waitForTimeout(800)
  const cam = await camera(player)
  await player.mouse.click(cam.x + (tk.x + 35 * tk.size) * cam.s, cam.y + (tk.y + 35 * tk.size) * cam.s)
  await player.getByRole('button', { name: 'Editar' }).click()
  await expect(player.getByLabel('Ficha vinculada')).toHaveCount(0)
  await player.getByLabel('Nome do token').fill('Aria, a Veloz')
  await player.getByLabel('Nome do token').press('Tab')
  await expect(player.getByRole('button', { name: /Apagar luz/ })).toHaveCount(0)
  await expect.poll(async () => (await tokens()).find((t) => t.id === tk.id)?.name).toBe('Aria, a Veloz')

  // O que o servidor recusa ao jogador.
  const refused = async (event: string, payload: object) => expect((await ps.emitWithAck(event, payload)).ok, event).toBe(false)
  const npc = (await gs.emitWithAck('token:create', { sceneId, name: 'Sem dono', x: 840, y: 700 })).data.id as string
  await refused('token:create', { sceneId, name: 'Sem ficha', x: 10, y: 10 })
  await refused('token:update', { id: orc, patch: { name: 'x' } })
  await refused('token:delete', { ids: [orc] })
  await refused('token:delete', { ids: [tk.id, npc] })
  for (const patch of [{ x: 1 }, { y: 1 }, { layer: 'gm' }, { actorId: null }, { light: null }, { vision: { range: 0, dark: 9000 } }]) await refused('token:update', { id: tk.id, patch })
  await refused('token:update', { id: tk.id, patch: { imageAssetId: crypto.randomUUID() } })
  // Camada do mestre vira padrão de tokens, mesmo pedindo.
  const actorId = (await gs.emitWithAck('scene:join', {})).data.tokens.find((t: Tk) => t.id === tk.id).actorId as string
  const sneaky = (await ps.emitWithAck('token:create', { sceneId, actorId, x: 70, y: 70, layer: 'gm', light: { bright: 9000, dim: 9000, color: '#fff' } })).data.id as string
  expect((await gs.emitWithAck('scene:join', {})).data.tokens.find((t: Tk) => t.id === sneaky).light.dim).toBeLessThan(9000)
  expect((await tokens()).find((t) => t.id === sneaky)?.layer).toBe('tokens')
  await ps.emitWithAck('token:delete', { ids: [sneaky] })

  // Tira pelo botão.
  await player.keyboard.press('Escape')
  await player.getByRole('button', { name: 'Apagar tokens' }).click()
  await expect.poll(async () => (await tokens()).filter((t) => t.mine).length).toBe(0)
  expect((await tokens()).some((t) => t.id === orc)).toBe(true)
  ps.disconnect()
  gs.disconnect()
})
