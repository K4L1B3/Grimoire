import { test, expect, type Page } from '@playwright/test'
import { captureFrames, createCampaign, dragFromLibrary, rawSocket, signUp } from './helpers'

test('modo masmorra: parede esconde inimigo da rede, porta abre, colisão e névoa', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id, invite } = await createCampaign(gm)
  const player = await signUp(browser, 'Jogadora')
  await player.goto(invite)

  await gm.goto(`/c/${id}/sheets`)
  await gm.getByRole('button', { name: 'Novo personagem' }).click()
  await gm.getByLabel('Nome', { exact: true }).fill('Lyra')
  await gm.getByRole('checkbox', { name: 'Jogadora' }).check()
  await gm.getByRole('button', { name: 'Criar', exact: true }).click()
  await gm.waitForURL(/\/sheets\/[^/]+$/)

  const gs = await rawSocket(gm, id)
  const snap = (await gs.emitWithAck('scene:join', {})).data
  const sceneId = snap.scene.id
  // Parede vertical em x=700 com porta fechada entre y=100 e y=300; luz fixa no lado do inimigo.
  const walls = (await gs.emitWithAck('wall:create', { sceneId, walls: [
    { points: [700, 0, 700, 100] }, { points: [700, 300, 700, 1050] }, { points: [700, 100, 700, 300], kind: 'door' },
  ] })).data.ids as string[]
  const door = walls[2]!
  await gs.emitWithAck('light:create', { sceneId, x: 1000, y: 175, bright: 200, dim: 300 })
  await gs.emitWithAck('scene:update', { sceneId, patch: { dungeon: true } })

  // Token da jogadora (com tocha) e um inimigo do outro lado da parede.
  const ps = await rawSocket(player, id)
  await gm.goto(`/c/${id}/play`)
  await gm.locator('[data-testid=board] canvas').waitFor({ timeout: 30_000 })
  await dragFromLibrary(gm, 'Personagens', 'Lyra', 120, 120)
  await gs.emitWithAck('token:create', { sceneId, name: 'Orc escondido', x: 980, y: 140 })
  const lyra = ((await gs.emitWithAck('scene:join', {})).data.tokens as { id: string; name: string }[]).find((t) => t.name === 'Lyra')!.id
  await gs.emitWithAck('token:move', { id: lyra, x: 140, y: 140 })
  const trap = (await gs.emitWithAck('pin:create', { sceneId, x: 1000 / 1400, y: 175 / 1050, label: 'Baú', visibility: 'all', hiddenByFog: true })).data.id

  const frames = captureFrames(player)
  await player.goto(`/c/${id}/play`)
  await player.locator('[data-testid=board] canvas').waitFor({ timeout: 30_000 })
  const pv = (await ps.emitWithAck('scene:join', {})).data
  expect(pv.tokens.map((t: { name: string }) => t.name)).toEqual(['Lyra'])
  expect(pv.pins).toEqual([])
  expect(pv.fog.bits.length).toBeGreaterThan(10)
  // O mestre vê os dois o tempo todo.
  expect((await gs.emitWithAck('scene:join', {})).data.tokens.length).toBe(2)

  // Porta fechada bloqueia a passagem (L6).
  expect((await ps.emitWithAck('token:move', { id: lyra, x: 840, y: 140 })).ok).toBe(false)

  // Jogadora abre a porta: o orc iluminado entra na vista e o baú sai da névoa (L2, L5, P8).
  expect((await ps.emitWithAck('door:toggle', { id: door })).ok).toBe(true)
  await expect.poll(() => frames.some((f) => f.includes('Orc escondido'))).toBe(true)
  await expect.poll(() => frames.some((f) => f.includes('pin:upsert') && f.includes('Baú'))).toBe(true)
  await expect(player.getByRole('button', { name: 'Baú' })).toBeVisible()
  expect((await ps.emitWithAck('token:move', { id: lyra, x: 840, y: 140 })).ok).toBe(true)

  // Volta e o mestre fecha e tranca: o orc sai da rede de novo; jogadora não destranca.
  expect((await ps.emitWithAck('token:move', { id: lyra, x: 140, y: 140 })).ok).toBe(true)
  await gs.emitWithAck('door:toggle', { id: door, lock: true })
  const after = (await ps.emitWithAck('scene:join', {})).data
  expect(after.tokens.map((t: { name: string }) => t.name)).toEqual(['Lyra'])
  expect((await ps.emitWithAck('door:toggle', { id: door })).ok).toBe(false)
  // Área já vista continua explorada: o baú (sob a névoa) segue visível depois de visto.
  expect(after.pins.map((p: { id: string }) => p.id)).toEqual([trap])

  for (const b of await player.getByRole('button', { name: 'Fechar janela' }).all()) await b.click()
  await player.waitForTimeout(1000)
  await player.screenshot({ path: test.info().outputPath('jogadora.png') })
  ps.close()
  gs.close()
})

test('modo masmorra fica à vista no painel de cenas e liga pela interface', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id } = await createCampaign(gm)
  const gs = await rawSocket(gm, id)
  await gm.getByRole('button', { name: 'mapa', exact: true }).click()
  const dungeon = gm.getByRole('switch', { name: 'Modo masmorra' })
  await dungeon.click()
  await expect(dungeon).toBeChecked()
  await expect(gm.getByRole('button', { name: 'Refazer a névoa' })).toBeVisible()
  await expect(gm.getByRole('button', { name: 'Revelar área na névoa' })).toBeVisible()
  await expect.poll(async () => (await gs.emitWithAck('scene:join', {})).data.scene.dungeon).toBe(true)
  gs.close()
})

// Opacidade da escuridão no ponto do mapa, direto do canvas que vira textura (0 = claro, 255 = breu).
const darkness = (page: Page, x: number, y: number) => page.evaluate(([x, y]) => {
  const dark = (window as unknown as { __board: { lightingC: { children: { texture: { source: { resource: HTMLCanvasElement } } }[] } } }).__board.lightingC.children[0]!
  const c = dark.texture.source.resource
  return c.getContext('2d')!.getImageData(x! * (c.width / 1400), y! * (c.width / 1400), 1, 1).data[3]!
}, [x, y])

const screen = (page: Page, x: number, y: number) => page.evaluate(([x, y]) => {
  const b = (window as unknown as { __board: { app: { canvas: HTMLCanvasElement }; world: { x: number; y: number; scale: { x: number } } } }).__board
  const r = b.app.canvas.getBoundingClientRect()
  return { x: r.left + b.world.x + x! * b.world.scale.x, y: r.top + b.world.y + y! * b.world.scale.x }
}, [x, y])

const maxFps = (page: Page) => page.evaluate(() => (window as unknown as { __board: { app: { ticker: { maxFPS: number } } } }).__board.app.ticker.maxFPS)

test('luz acompanha o token no arraste, para na parede e o token desliza para quem assiste', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id, invite } = await createCampaign(gm)
  const player = await signUp(browser, 'Jogadora')
  await player.goto(invite)
  await gm.goto(`/c/${id}/sheets`)
  await gm.getByRole('button', { name: 'Novo personagem' }).click()
  await gm.getByLabel('Nome', { exact: true }).fill('Lyra')
  await gm.getByRole('checkbox', { name: 'Jogadora' }).check()
  await gm.getByRole('button', { name: 'Criar', exact: true }).click()
  await gm.waitForURL(/\/sheets\/[^/]+$/)

  const gs = await rawSocket(gm, id)
  const sceneId = (await gs.emitWithAck('scene:join', {})).data.scene.id
  await gs.emitWithAck('wall:create', { sceneId, walls: [{ points: [700, 0, 700, 1050] }] })
  await gs.emitWithAck('scene:update', { sceneId, patch: { dungeon: true } })
  await gm.goto(`/c/${id}/play`)
  await gm.locator('[data-testid=board] canvas').waitFor({ timeout: 30_000 })
  await dragFromLibrary(gm, 'Personagens', 'Lyra', 120, 120)
  await expect.poll(async () => (await gs.emitWithAck('scene:join', {})).data.tokens.length).toBe(1)
  const lyra = (await gs.emitWithAck('scene:join', {})).data.tokens[0].id as string
  await gs.emitWithAck('token:update', { id: lyra, patch: { light: { bright: 300, dim: 300, color: '#ffaa44' } } })
  await gs.emitWithAck('token:move', { id: lyra, x: 105, y: 105 })

  await player.goto(`/c/${id}/play`)
  await player.locator('[data-testid=board] canvas').waitFor({ timeout: 30_000 })
  for (const b of await player.getByRole('button', { name: 'Fechar janela' }).all()) await b.click()
  const half = 35 // Token de 1 quadrado: o centro fica a meio quadrado do canto.
  await expect.poll(() => darkness(player, 105 + half, 105 + half)).toBe(0)
  const before = await darkness(player, 500, 140)
  expect(before).toBeGreaterThan(200)

  // Ainda segurando o botão: o servidor não sabe de nada e a luz já está lá.
  const from = await screen(player, 105 + half, 105 + half), mid = await screen(player, 500, 140), beyond = await screen(player, 900, 140)
  await player.mouse.move(from.x, from.y)
  await player.mouse.down()
  await player.mouse.move(mid.x, mid.y, { steps: 8 })
  await expect.poll(() => darkness(player, 500, 140)).toBe(0)
  await player.mouse.move(mid.x + 1, mid.y)
  expect(await maxFps(player)).toBe(0)

  // Do outro lado da parede a luz não vai: a sala de lá continua breu, mesmo com o sprite arrastado até lá.
  await player.mouse.move(beyond.x, beyond.y, { steps: 8 })
  await player.waitForTimeout(100)
  expect(await darkness(player, 900, 140)).toBeGreaterThan(200)
  expect(await darkness(player, 500, 140)).toBe(0)

  // Soltar ali é recusado: nem no vaivém da resposta do servidor a sala de lá acende.
  const peek = player.evaluate(() => new Promise<number>((done) => {
    const c = (window as unknown as { __board: { lightingC: { children: { texture: { source: { resource: HTMLCanvasElement } } }[] } } }).__board.lightingC.children[0]!.texture.source.resource
    let least = 255, n = 0
    const frame = () => {
      least = Math.min(least, c.getContext('2d')!.getImageData(900 * (c.width / 1400), 140 * (c.width / 1400), 1, 1).data[3]!)
      if (++n < 40) requestAnimationFrame(frame); else done(least)
    }
    frame()
  }))
  await player.mouse.up()
  expect(await peek).toBeGreaterThan(200)
  await expect(player.getByText('Tem uma parede no caminho')).toBeVisible()

  // Quem assiste vê o token passar por posições intermediárias, não teleportar.
  const seen = gm.evaluate((id) => new Promise<number[]>((done) => {
    const e = (window as unknown as { __board: { tokens: Map<string, { c: { x: number } }> } }).__board.tokens.get(id)!
    const xs: number[] = []
    const frame = () => { xs.push(e.c.x); if (xs.length < 60) requestAnimationFrame(frame); else done(xs) }
    frame()
  }), lyra)
  await gs.emitWithAck('token:move', { id: lyra, x: 455, y: 105 })
  const xs = await seen
  expect(xs.at(-1)).toBe(455)
  expect(new Set(xs.filter((x) => x !== 105 && x !== 455)).size).toBeGreaterThan(3)

  // Onde a luz saiu volta ao breu para o jogador, mesmo já explorado.
  await expect.poll(() => darkness(player, 140, 140)).toBe(255)

  // Com tudo parado a mesa volta ao limite que poupa a máquina.
  await expect.poll(() => maxFps(gm)).toBeGreaterThan(0)
  gs.close()
})
