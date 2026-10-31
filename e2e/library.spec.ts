import { test, expect } from '@playwright/test'
import { answer, createCampaign, dragFromLibrary, fixture, rawSocket, signUp } from './helpers'

test('biblioteca, janelas flutuantes, ficha importada e digitar no campo recém-desenhado', async ({ browser }) => {
  test.setTimeout(240_000)
  const gm = await signUp(browser, 'Mestre')
  await gm.setViewportSize({ width: 1500, height: 950 })
  const { id, invite } = await createCampaign(gm)
  await gm.goto(`/c/${id}/play`)
  await expect(gm.getByTestId('board').locator('canvas')).toBeVisible({ timeout: 30_000 })
  const bar = gm.getByRole('toolbar', { name: 'Biblioteca' })

  // Pasta e criatura (com o único PDF importado no assistente, a ficha já nasce nele).
  await bar.getByRole('button', { name: 'Criaturas' }).click()
  await gm.getByRole('button', { name: 'Pasta' }).click()
  await answer(gm, 'Masmorra')
  await gm.getByRole('button', { name: 'Criatura', exact: true }).click()
  await answer(gm, 'Goblin')
  const sheetWin = gm.getByRole('dialog', { name: 'Goblin' })
  await expect(sheetWin).toBeVisible()
  await sheetWin.getByRole('button', { name: 'Minimizar' }).click()

  // Arrastar para a pasta organiza; arrastar para o mapa cria o token.
  await gm.locator('li[data-tile]', { hasText: 'Goblin' }).dragTo(gm.locator('li', { hasText: 'Masmorra' }))
  await expect(gm.locator('li[data-tile]', { hasText: 'Goblin' })).toHaveCount(0)
  await gm.locator('li', { hasText: 'Masmorra' }).getByRole('button').first().click()
  await dragFromLibrary(gm, 'Criaturas', 'Goblin', 500, 300)
  const gs = await rawSocket(gm, id)
  await expect.poll(async () => (await gs.emitWithAck('scene:join', {})).data.tokens.map((t: { name: string }) => t.name)).toContain('Goblin')

  // Redimensionar o token arrastando a alça do canto (vira 2×2 células).
  await gm.getByRole('button', { name: 'Fechar biblioteca' }).click()
  const view = await gm.evaluate(() => [...document.querySelectorAll('[data-testid=board] canvas')].length)
  expect(view).toBe(1)
  const tok = (await gs.emitWithAck('scene:join', {})).data.tokens.find((t: { name: string }) => t.name === 'Goblin')
  const bbox = (await gm.getByTestId('board').boundingBox())!
  // Posição do token na tela: o mapa é enquadrado ao abrir; medimos pela régua do próprio grid.
  const fit = await gm.evaluate(([w, h]) => Math.min(w / 1400, h / 1050) * 0.95, [bbox.width, bbox.height])
  const ox = bbox.x + (bbox.width - 1400 * fit) / 2, oy = bbox.y + (bbox.height - 1050 * fit) / 2
  await gm.mouse.click(ox + (tok.x + 35) * fit, oy + (tok.y + 35) * fit)
  const hx = ox + (tok.x + 70) * fit, hy = oy + (tok.y + 70) * fit
  await gm.mouse.move(hx, hy)
  await gm.mouse.down()
  await gm.mouse.move(hx + 40 * fit, hy + 40 * fit, { steps: 3 })
  await gm.mouse.move(hx + 75 * fit, hy + 75 * fit, { steps: 3 })
  await gm.mouse.up()
  await expect.poll(async () => (await gs.emitWithAck('scene:join', {})).data.tokens.find((t: { name: string }) => t.name === 'Goblin').size).toBe(2)
  await gm.getByRole('button', { name: 'Goblin' }).last().click()

  // "Fichas" na barra lateral abre janela; abrir de novo a mesma ficha não duplica.
  await gm.getByRole('button', { name: 'Fichas' }).click()
  const list = gm.getByRole('dialog', { name: 'Fichas' })
  await list.getByRole('button', { name: 'Goblin' }).click()
  await expect(gm.getByRole('dialog', { name: 'Goblin' })).toHaveCount(1)

  // Editar campos na própria ficha: desenha a caixa e já digita nela (o valor vai para esta ficha).
  await sheetWin.getByRole('button', { name: 'Editar campos' }).click()
  const editor = gm.getByRole('dialog', { name: 'Campos · Goblin' })
  const page = editor.locator('[data-page="0"]')
  await expect(page).toBeVisible({ timeout: 30_000 })
  const box = (await page.boundingBox())!
  const at = (x: number, y: number) => [box.x + (x / 595) * box.width, box.y + (y / 842) * box.height] as const
  await gm.mouse.move(...at(320, 12))
  await gm.mouse.down()
  await gm.mouse.move(...at(430, 22), { steps: 3 })
  await gm.mouse.move(...at(550, 34), { steps: 3 })
  await gm.mouse.up()
  await expect(editor.locator('input:focus, textarea:focus')).toHaveCount(1)
  await gm.keyboard.type('Escreveu na hora')
  // O texto aparece na janela da ficha (mesma tela, outra janela).
  await expect.poll(() => sheetWin.locator('input, textarea').evaluateAll((els) => els.some((e) => (e as HTMLInputElement).value === 'Escreveu na hora')), { timeout: 15_000 }).toBe(true)

  // Anexo mostrado aos jogadores abre na tela da jogadora.
  const player = await signUp(browser, 'Jogadora')
  await player.goto(invite)
  await player.waitForURL(/\/play/)
  const closeBtn = gm.getByRole('button', { name: 'Fechar janela' })
  while (await closeBtn.count()) await closeBtn.first().dispatchEvent('click')
  await bar.getByRole('button', { name: 'Anexos' }).click()
  await gm.locator('section input[type=file][multiple]').setInputFiles(fixture('mapa.png'))
  const tile = gm.locator('li[data-tile]', { hasText: 'mapa' })
  await tile.hover()
  await tile.getByRole('button', { name: 'Mostrar aos jogadores' }).click()
  await expect(player.getByRole('dialog', { name: 'mapa.png' })).toBeVisible()

  // Jogadora cria o próprio personagem: a ficha abre em janela e continua aberta ao recarregar.
  await player.getByRole('dialog', { name: 'mapa.png' }).getByRole('button', { name: 'Fechar janela' }).click()
  await player.getByRole('toolbar', { name: 'Biblioteca' }).getByRole('button', { name: 'Personagens' }).click()
  await player.getByRole('button', { name: 'Personagem', exact: true }).click()
  await answer(player, 'Lyra')
  await expect(player.getByRole('dialog', { name: 'Lyra' })).toBeVisible()
  await player.reload()
  await expect(player.getByRole('dialog', { name: 'Lyra' })).toBeVisible({ timeout: 30_000 })
  gs.close()
})
