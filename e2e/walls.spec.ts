import { test, expect, type Page } from '@playwright/test'
import { createCampaign, rawSocket, signUp } from './helpers'

// Coordenada do mapa → pixel da tela, pela câmera do Board.
const camera = (gm: Page) => gm.evaluate(() => {
  const b = (window as unknown as { __board: { app: { canvas: HTMLCanvasElement }; world: { x: number; y: number; scale: { x: number } } } }).__board
  const r = b.app.canvas.getBoundingClientRect()
  return { ox: r.left + b.world.x, oy: r.top + b.world.y, k: b.world.scale.x }
})

test('mestre edita paredes, portas e luzes só com o mouse', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id } = await createCampaign(gm)
  await gm.locator('[data-testid=board] canvas').waitFor({ timeout: 30_000 })
  const gs = await rawSocket(gm, id)
  const sceneId = (await gs.emitWithAck('scene:join', {})).data.scene.id
  await gs.emitWithAck('scene:update', { sceneId, patch: { grid: { show: true, size: 70, offsetX: 0, offsetY: 0 } } })
  await gm.waitForTimeout(500)
  const { ox, oy, k } = await camera(gm)
  const at = (x: number, y: number) => [ox + x * k, oy + y * k] as const
  const walls = async () => (await gs.emitWithAck('scene:join', { sceneId })).data.walls as { id: string; points: number[]; kind: string; state: string | null }[]
  const lights = async () => (await gs.emitWithAck('scene:join', { sceneId })).data.lights as { id: string; x: number; y: number }[]
  const drag = async (a: readonly [number, number], b: readonly [number, number]) => {
    await gm.mouse.move(...a); await gm.mouse.down(); await gm.mouse.move(...b, { steps: 6 }); await gm.mouse.up()
  }
  const tool = (name: string) => gm.getByRole('button', { name }).click()

  // Arrastar desenha uma parede; clique que escorrega não quebra a cadeia; Esc fica na ferramenta.
  await tool('Paredes (W)')
  await drag(at(140, 140), at(700, 140))
  await expect.poll(walls).toHaveLength(1)
  expect((await walls())[0]!.points).toEqual([700, 140, 140, 140])
  await gm.mouse.click(...at(140, 420))
  await drag(at(420, 420), [ox + 423 * k + 6, oy + 420 * k])
  await expect.poll(walls).toHaveLength(2)
  await gm.keyboard.press('Escape')
  await expect(gm.getByRole('button', { name: 'Paredes (W)' })).toHaveAttribute('aria-pressed', 'true')
  await gm.mouse.click(...at(140, 700))
  await gm.mouse.click(...at(420, 700))
  await expect.poll(walls).toHaveLength(3)
  await gm.keyboard.press('Escape')

  // Clique na parede: porta de 1 quadrado, e a parede abre o vão.
  await tool('Porta / janela')
  await gm.mouse.click(...at(385, 140))
  await expect.poll(async () => (await walls()).map((w) => w.kind).sort()).toEqual(['door', 'wall', 'wall', 'wall', 'wall'])
  const door = (await walls()).find((w) => w.kind === 'door')!
  expect([...door.points].sort((a, b) => a - b)).toEqual([140, 140, 350, 420])

  // Arrastar sobre a parede: porta do tamanho pedido.
  await drag(at(490, 140), at(630, 140))
  await expect.poll(async () => (await walls()).filter((w) => w.kind === 'door').length).toBe(2)
  await expect.poll(async () => (await walls()).length).toBe(7)

  // Arrastar num vão, sem parede nenhuma: porta solta.
  await drag(at(840, 280), at(840, 420))
  await expect.poll(async () => (await walls()).filter((w) => w.kind === 'door').length).toBe(3)

  // Com a seta, o ícone da porta abre e fecha.
  await gm.keyboard.press('v')
  const [dx, dy] = [(door.points[0]! + door.points[2]!) / 2, (door.points[1]! + door.points[3]!) / 2]
  await gm.mouse.click(...at(dx, dy))
  await expect.poll(async () => (await walls()).find((w) => w.id === door.id)?.state).toBe('open')
  await gm.mouse.click(...at(dx, dy))
  await expect.poll(async () => (await walls()).find((w) => w.id === door.id)?.state).toBe('closed')
  await gm.screenshot({ path: test.info().outputPath('mesa.png') })
  await tool('Porta / janela')

  // Desfazer devolve a parede inteira.
  await gm.keyboard.press('Control+z') // porta solta
  await expect.poll(async () => (await walls()).filter((w) => w.kind === 'door').length).toBe(2)
  await gm.keyboard.press('Control+z') // porta arrastada
  await expect.poll(async () => (await walls()).length).toBe(5)

  // Borracha apaga parede, porta e luz.
  await tool('Luz')
  await gm.mouse.click(...at(900, 560))
  await expect.poll(lights).toHaveLength(1)
  await gm.getByRole('button', { name: 'Fechar', exact: true }).click()
  await drag(at(900, 560), at(1050, 630))
  await expect.poll(async () => (await lights())[0]?.x).toBeGreaterThan(1000)
  const lit = (await lights())[0]!
  await gm.keyboard.press('e')
  await gm.mouse.click(...at(lit.x, lit.y))
  await expect.poll(lights).toHaveLength(0)
  const before = (await walls()).length
  await gm.mouse.click(...at(280, 420)) // a parede clicada em cadeia, de y=420
  await expect.poll(async () => (await walls()).length).toBe(before - 1)
  await gm.mouse.click(...at(385, 140))
  await expect.poll(async () => (await walls()).filter((w) => w.kind === 'door').length).toBe(0)

  // Mapa girado: parede diagonal sem grid (Shift); a porta nasce em cima dela, centrada no clique.
  await tool('Paredes (W)')
  await gm.keyboard.down('Shift')
  await drag(at(903, 203), at(1203, 503))
  await gm.keyboard.up('Shift')
  await expect.poll(async () => (await walls()).some((w) => w.points.includes(1203))).toBe(true)
  await tool('Porta / janela')
  await gm.mouse.click(...at(1053, 353))
  await expect.poll(async () => (await walls()).filter((w) => w.kind === 'door').length).toBe(1)
  const diag = (await walls()).find((w) => w.kind === 'door')!
  expect(Math.round((diag.points[0]! + diag.points[2]!) / 2)).toBe(1053)
  expect(Math.round(Math.hypot(diag.points[2]! - diag.points[0]!, diag.points[3]! - diag.points[1]!))).toBe(70)
  gs.close()
})

test('mestre seleciona luz e parede: lixeira, lápis, Del e alças', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id } = await createCampaign(gm)
  await gm.locator('[data-testid=board] canvas').waitFor({ timeout: 30_000 })
  const gs = await rawSocket(gm, id)
  const sceneId = (await gs.emitWithAck('scene:join', {})).data.scene.id
  await gs.emitWithAck('scene:update', { sceneId, patch: { grid: { show: true, size: 70, offsetX: 0, offsetY: 0 } } })
  await gs.emitWithAck('token:create', { sceneId, name: 'Orc', x: 1050, y: 700 })
  await gs.emitWithAck('wall:create', { sceneId, walls: [{ points: [140, 140, 560, 140] }, { points: [560, 140, 560, 560] }] })
  await gs.emitWithAck('light:create', { sceneId, x: 840, y: 280, bright: 140, dim: 280 })
  await gm.waitForTimeout(800)
  const { ox, oy, k } = await camera(gm)
  const at = (x: number, y: number) => [ox + x * k, oy + y * k] as const
  const state = async () => (await gs.emitWithAck('scene:join', { sceneId })).data as { tokens: unknown[]; walls: { id: string; points: number[]; kind: string; state: string | null }[]; lights: { x: number; bright: number }[] }
  const drag = async (a: readonly [number, number], b: readonly [number, number]) => {
    await gm.mouse.move(...a); await gm.mouse.down(); await gm.mouse.move(...b, { steps: 6 }); await gm.mouse.up()
  }

  // Luz: clicar com a seta mostra lápis e lixeira; o lápis abre os raios.
  await gm.mouse.click(...at(840, 280))
  await gm.getByRole('button', { name: 'Editar luz' }).click()
  await gm.getByRole('slider', { name: /Penumbra/ }).fill('30')
  await expect.poll(async () => Math.round((await state()).lights[0]!.bright)).toBe(140)
  // Del com o controle em foco apaga a luz, e Ctrl+Z traz de volta; a lixeira também apaga.
  await gm.keyboard.press('Delete')
  await expect.poll(async () => (await state()).lights.length).toBe(0)
  await expect(gm.getByRole('button', { name: 'Apagar luz' })).toHaveCount(0)
  await gm.keyboard.press('Control+z')
  await expect.poll(async () => (await state()).lights.length).toBe(1)
  await gm.waitForTimeout(300)
  await gm.mouse.click(...at(840, 280))
  await gm.getByRole('button', { name: 'Apagar luz' }).click()
  await expect.poll(async () => (await state()).lights.length).toBe(0)
  await gm.keyboard.press('Control+z')
  await expect.poll(async () => (await state()).lights.length).toBe(1)
  await gm.waitForTimeout(300)

  // Arrastar com a seta move a luz sem abrir seleção de área.
  await drag(at(840, 280), at(980, 280))
  await expect.poll(async () => (await state()).lights[0]!.x).toBeGreaterThan(950)

  // Parede: lápis troca o tipo sem mexer no resto; porta tranca sem virar parede.
  await gm.mouse.click(...at(300, 140))
  await gm.getByRole('button', { name: 'Editar parede' }).click()
  await gm.getByRole('button', { name: 'Porta', exact: true }).click()
  await expect.poll(async () => (await state()).walls.find((w) => w.kind === 'door')?.state).toBe('closed')
  await gm.getByRole('button', { name: 'Trancada' }).click()
  await expect.poll(async () => (await state()).walls.find((w) => w.kind === 'door')?.state).toBe('locked')
  await gm.getByRole('button', { name: 'Parede', exact: true }).click()
  await expect.poll(async () => (await state()).walls.filter((w) => w.kind === 'door').length).toBe(0)
  await gm.getByRole('button', { name: 'Fechar', exact: true }).click()

  // Alça: arrastar a ponta leva junto a outra parede do mesmo canto; Ctrl+Z desfaz as duas.
  await drag(at(560, 140), at(630, 210))
  await expect.poll(async () => (await state()).walls.map((w) => w.points).sort()).toEqual([[140, 140, 630, 210], [630, 210, 560, 560]])
  await gm.screenshot({ path: test.info().outputPath('selecao.png') })
  await gm.keyboard.press('Control+z')
  await expect.poll(async () => (await state()).walls.map((w) => w.points).sort()).toEqual([[140, 140, 560, 140], [560, 140, 560, 560]])
  await gm.waitForTimeout(300) // o banco já desfez; a tela chega logo depois

  // Del apaga a parede selecionada e não o token; Esc solta a seleção sem sair da seta.
  await gm.mouse.click(...at(560, 350))
  await expect(gm.getByRole('button', { name: 'Apagar parede' })).toBeVisible()
  await gm.keyboard.press('Escape')
  await expect(gm.getByRole('button', { name: 'Apagar parede' })).toHaveCount(0)
  await gm.keyboard.press('Delete')
  await expect.poll(async () => (await state()).walls.length).toBe(2)
  await gm.mouse.click(...at(560, 350))
  await gm.keyboard.press('Delete')
  await expect.poll(async () => (await state()).walls.length).toBe(1)
  expect((await state()).tokens).toHaveLength(1)

  // Selecionar um token solta a parede: Del apaga só o token.
  await gm.mouse.click(...at(300, 140))
  await expect(gm.getByRole('button', { name: 'Apagar parede' })).toBeVisible()
  await gm.mouse.click(...at(1085, 735))
  await expect(gm.getByRole('button', { name: 'Apagar parede' })).toHaveCount(0)
  await gm.keyboard.press('Delete')
  await expect.poll(async () => (await state()).tokens.length).toBe(0)
  expect((await state()).walls).toHaveLength(1)
  gs.close()
})
