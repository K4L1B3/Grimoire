import { test, expect, type Page } from '@playwright/test'
import { answer, createCampaign, fixture, rawSocket, signUp } from './helpers'

const camera = (p: Page) => p.evaluate(() => {
  const b = (window as unknown as { __board: { app: { canvas: HTMLCanvasElement }; world: { x: number; y: number; scale: { x: number } } } }).__board
  const r = b.app.canvas.getBoundingClientRect()
  return { x: r.left + b.world.x, y: r.top + b.world.y, s: b.world.scale.x }
})

test('masmorra: mover token, área, porta na parede, névoa do mestre, luz, ficha e imagem do token, combate', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id } = await createCampaign(gm)
  const gs = await rawSocket(gm, id)
  const sceneId = (await gs.emitWithAck('scene:join', {})).data.scene.id
  const state = async () => (await gs.emitWithAck('scene:join', {})).data
  await gs.emitWithAck('token:create', { sceneId, name: 'Orc', x: 280, y: 280 })
  await gs.emitWithAck('token:create', { sceneId, name: 'Goblin', x: 420, y: 280 })
  await gs.emitWithAck('wall:create', { sceneId, walls: [{ points: [700, 70, 700, 490] }] })
  await gs.emitWithAck('scene:update', { sceneId, patch: { dungeon: true, grid: { show: true } } })
  await gm.goto(`/c/${id}/play`)
  await gm.locator('[data-testid=board] canvas').waitFor({ timeout: 30_000 })
  await gm.waitForTimeout(1500)
  const cam = await camera(gm)
  const at = (x: number, y: number) => [cam.x + x * cam.s, cam.y + y * cam.s] as const
  const drag = async (a: readonly [number, number], b: readonly [number, number]) => {
    await gm.mouse.move(...a); await gm.mouse.down(); await gm.mouse.move(...b, { steps: 6 }); await gm.mouse.up()
  }

  // Token anda na masmorra (a escuridão não tapa mais o clique).
  await drag(at(315, 315), at(315, 455))
  await expect.poll(async () => (await state()).tokens.find((t: { name: string }) => t.name === 'Orc').y).toBe(420)

  // Arrastar no vazio seleciona uma área, sem mover a câmera.
  await drag(at(200, 200), at(600, 560))
  await expect(gm.getByText('2 selecionados')).toBeVisible()
  expect((await camera(gm)).x).toBe(cam.x)

  // Um clique na ferramenta de porta corta a parede comprida.
  await gm.getByRole('button', { name: 'Porta / janela' }).click()
  await gm.mouse.click(...at(700, 280))
  await expect.poll(async () => (await state()).walls.length).toBe(3)
  const walls = (await state()).walls as { kind: string; points: number[]; state: string }[]
  expect(walls.find((w) => w.kind === 'door')!.points).toEqual([700, 210, 700, 280])

  // Com a seta, o ícone abre a porta.
  await gm.getByRole('button', { name: /Selecionar e mover/ }).click()
  await gm.mouse.click(...at(700, 245))
  await expect.poll(async () => (await state()).walls.find((w: { kind: string }) => w.kind === 'door').state).toBe('open')

  // Revelar área chega ao mestre mesmo sem nenhum jogador na campanha.
  expect((await state()).fog.bits).toMatch(/^A+=*$/)
  await gm.getByRole('button', { name: 'Revelar área na névoa' }).click()
  await drag(at(100, 600), at(400, 800))
  await expect.poll(async () => (await state()).fog.bits).not.toMatch(/^A+=*$/)

  // Ponto de luz: criar abre o editor; o controle muda o raio.
  await gm.getByRole('button', { name: 'Luz', exact: true }).click()
  await gm.mouse.click(...at(1000, 300))
  const dim = gm.getByRole('slider', { name: /Penumbra/ })
  await dim.fill('30')
  await expect.poll(async () => Math.round((await state()).lights[0].dim)).toBe(1400)
  await gm.keyboard.press('Escape')

  // Clique no token: ficha, imagem e vínculo.
  await gm.getByRole('button', { name: /Selecionar e mover/ }).click()
  await gs.emitWithAck('combat:end', { sceneId })
  await gm.mouse.click(...at(455, 315))
  await gm.getByRole('button', { name: 'Editar', exact: true }).click()
  await expect(gm.getByLabel('Ficha vinculada')).toBeVisible()
  await gm.getByLabel('Imagem do token', { exact: true }).setInputFiles('e2e/fixtures/mapa.png')
  await expect.poll(async () => (await state()).tokens.find((t: { name: string }) => t.name === 'Goblin').image).toBeTruthy()
  await gm.getByRole('button', { name: 'Fechar', exact: true }).click()

  // Combate: vincular token pelo menu, retrato na lista e modal próprio ao encerrar.
  await gm.getByRole('button', { name: 'Combate', exact: true }).click()
  await gm.getByRole('button', { name: 'Adicionar Goblin ao combate' }).click()
  await expect(gm.getByRole('button', { name: 'Adicionar Goblin ao combate' })).toHaveCount(0)
  await gm.getByRole('button', { name: 'Encerrar', exact: true }).click()
  const box = gm.locator('dialog[open]')
  await expect(box).toBeVisible()
  await box.getByRole('button', { name: 'Encerrar', exact: true }).click()
  await expect.poll(async () => (await state()).combat).toBeNull()
  gs.close()
})

test('janela maximiza e redimensiona pelas bordas; sessões de cenas sanfonam', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id } = await createCampaign(gm)
  await gm.goto(`/c/${id}/play`)
  await gm.locator('[data-testid=board] canvas').waitFor({ timeout: 30_000 })

  await gm.getByRole('button', { name: 'Combate', exact: true }).click()
  const win = gm.getByRole('dialog', { name: 'Combate' })
  const se = (await win.locator('[data-resize=se]').boundingBox())!
  await gm.mouse.move(se.x + 10, se.y + 10); await gm.mouse.down(); await gm.mouse.move(se.x + 90, se.y + 70, { steps: 4 }); await gm.mouse.up()
  const after = (await win.boundingBox())!
  expect(after.width).toBe(480 + 80)
  expect(after.height).toBe(640 + 60)
  await win.getByRole('button', { name: 'Maximizar' }).click()
  expect((await win.boundingBox())!.width).toBe(1280 - 72)
  await win.getByRole('button', { name: 'Restaurar' }).click()
  expect((await win.boundingBox())!.width).toBe(after.width)
  await win.getByRole('button', { name: 'Fechar janela' }).click()

  await gm.getByRole('button', { name: 'mapa', exact: true }).click()
  await gm.getByRole('button', { name: 'Nova sessão' }).click()
  await answer(gm, 'Sessão 1')
  const session = gm.getByRole('region', { name: 'Sessão 1' })
  await expect(session).toBeVisible()
  await gm.locator('li[data-tile]', { hasText: 'mapa' }).first().dragTo(session)
  await expect(session.locator('li[data-tile]')).toHaveCount(1)
  const toggle = session.getByRole('button', { name: /^Sessão 1/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

test('importar PDF pela janela Fichas, escolher ficha e abrir pelo token vinculado', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id } = await createCampaign(gm)
  const gs = await rawSocket(gm, id)
  const sceneId = (await gs.emitWithAck('scene:join', {})).data.scene.id
  const tk = (await gs.emitWithAck('token:create', { sceneId, name: 'Vulto', x: 280, y: 280 })).data.id
  await gm.goto(`/c/${id}/play`)
  await gm.locator('[data-testid=board] canvas').waitFor({ timeout: 30_000 })
  await gm.waitForTimeout(1500)

  // Segundo PDF: abre direto o editor de campos dele.
  await gm.getByRole('button', { name: 'Fichas' }).click()
  const list = gm.getByRole('dialog', { name: 'Fichas' })
  await list.getByLabel('Importar ficha em PDF').setInputFiles(fixture('ficha.pdf'))
  await expect(gm.getByRole('dialog', { name: 'Campos · ficha' })).toBeVisible({ timeout: 30_000 })
  await gm.getByRole('dialog', { name: 'Campos · ficha' }).getByRole('button', { name: 'Fechar janela' }).click()
  await expect(list.getByRole('button', { name: 'Editar campos' })).toHaveCount(2)

  // Com dois PDFs, a criatura nasce sem ficha e a pessoa escolhe qual usar.
  await gm.getByRole('toolbar', { name: 'Biblioteca' }).getByRole('button', { name: 'Criaturas' }).click()
  await gm.getByRole('button', { name: 'Criatura', exact: true }).click()
  await answer(gm, 'Espectro')
  await list.getByLabel('Escolher ficha de Espectro').selectOption({ index: 1 })
  await expect(gm.getByRole('dialog', { name: 'Espectro' })).toBeVisible({ timeout: 30_000 })
  await gm.getByRole('dialog', { name: 'Espectro' }).getByRole('button', { name: 'Fechar janela' }).click()
  await list.getByRole('button', { name: 'Fechar janela' }).click()
  await gm.getByRole('button', { name: 'Fechar biblioteca' }).click()

  // Vincular a ficha ao token pelo editor; depois o clique no token oferece "Ficha".
  const cam = await camera(gm)
  await gm.mouse.click(cam.x + 315 * cam.s, cam.y + 315 * cam.s)
  await gm.getByRole('button', { name: 'Editar', exact: true }).click()
  await gm.getByLabel('Ficha vinculada').selectOption({ label: 'Espectro' })
  await expect.poll(async () => ((await gs.emitWithAck('scene:join', {})).data.tokens as { id: string; sheetId: string | null }[]).find((t) => t.id === tk)!.sheetId).toBeTruthy()
  await gm.getByRole('button', { name: 'Fechar', exact: true }).click()
  await gm.getByRole('button', { name: 'Ficha', exact: true }).click()
  await expect(gm.getByRole('dialog', { name: 'Espectro' })).toBeVisible()
  gs.close()
})

test('grid desligado por padrão: token anda livre em arraste longo; ligar o grid volta o encaixe', async ({ browser }) => {
  test.setTimeout(240_000) // Modo dev: centenas de passos de mouse, um a um.
  const gm = await signUp(browser, 'Mestre')
  const { id } = await createCampaign(gm)
  const gs = await rawSocket(gm, id)
  const sceneId = (await gs.emitWithAck('scene:join', {})).data.scene.id
  const orc = async () => (await gs.emitWithAck('scene:join', {})).data.tokens.find((t: { name: string }) => t.name === 'Orc') as { x: number; y: number }
  await gs.emitWithAck('token:create', { sceneId, name: 'Orc', x: 280, y: 280 })
  await gm.goto(`/c/${id}/play`)
  await gm.locator('[data-testid=board] canvas').waitFor({ timeout: 30_000 })
  await gm.waitForTimeout(1500)
  const cam = await camera(gm)
  const at = (x: number, y: number) => [cam.x + x * cam.s, cam.y + y * cam.s] as const

  // Clique sem arrastar não mexe no token.
  await gm.mouse.click(...at(315, 315))
  await gm.waitForTimeout(300)
  expect(await orc()).toMatchObject({ x: 280, y: 280 })

  // Arraste de muitos passos, em zigue-zague: sem encaixe o caminho precisa continuar dentro do limite do servidor.
  await gm.mouse.move(...at(315, 315))
  await gm.mouse.down()
  for (let i = 1; i <= 300; i++) await gm.mouse.move(...at(315 + i * 0.5, 315 + (i % 2) * 4))
  await gm.mouse.move(...at(498, 353))
  await gm.mouse.up()
  await expect.poll(async () => (await orc()).x).toBeGreaterThan(450)
  const free = await orc()
  expect(free.x % 70).not.toBe(0)
  expect(free.y % 70).not.toBe(0)

  // Com o grid ligado, o token volta a cair no canto da célula.
  await gs.emitWithAck('scene:update', { sceneId, patch: { grid: { show: true } } })
  await gm.waitForTimeout(300)
  await gm.mouse.move(...at(free.x + 35, free.y + 35))
  await gm.mouse.down()
  await gm.mouse.move(...at(free.x + 135, free.y + 35), { steps: 6 })
  await gm.mouse.up()
  await expect.poll(async () => (await orc()).x % 70).toBe(0)
  expect((await orc()).y % 70).toBe(0)
})
