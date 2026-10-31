import { test, expect, type Page } from '@playwright/test'
import { createCampaign, signUp } from './helpers'

// Arrasta um retângulo sobre a página do PDF, em coordenadas de PDF (pontos, origem em cima).
async function draw(page: Page, [x1, y1, x2, y2]: number[]) {
  const box = (await page.locator('[data-page="0"]').boundingBox())!
  const at = (x: number, y: number) => [box.x + (x / 595) * box.width, box.y + (y / 842) * box.height] as const
  await page.mouse.move(...at(x1!, y1!))
  await page.mouse.down()
  await page.mouse.move(...at((x1! + x2!) / 2, (y1! + y2!) / 2), { steps: 4 })
  await page.mouse.move(...at(x2!, y2!), { steps: 4 })
  await page.mouse.up()
}

test('mestre monta a ficha e o modificador recalcula ao vivo na tela dele', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id, invite } = await createCampaign(gm)
  const player = await signUp(browser, 'Jogadora')
  await player.goto(invite)

  await gm.goto(`/c/${id}/sheets`)
  await gm.locator('li', { hasText: /^ficha/ }).getByRole('link', { name: 'Editar campos' }).click()
  await expect(gm.locator('[data-page="0"]')).toBeVisible({ timeout: 30_000 })

  // A caixa ao lado de "Força" vira o campo "forca" sozinha (nome lido do PDF).
  await draw(gm, [163, 116, 277, 138])
  await expect(gm.getByLabel('Nome do campo')).toHaveValue('forca')
  await gm.getByLabel('Tipo').selectOption('number')

  await draw(gm, [163, 166, 277, 186])
  await expect(gm.getByLabel('Nome do campo')).toHaveValue('destreza')
  await gm.getByLabel('Nome do campo').fill('mod_forca')
  await gm.getByLabel('Nome do campo').blur()
  await gm.getByLabel('Tipo').selectOption('number')
  const formula = gm.getByPlaceholder('floor((forca-10)/2)')
  await formula.fill('floor((forca-10)/2)')
  await formula.press('Enter')
  await gm.getByPlaceholder('1d20 + @mod_forca').fill('1d20 + @mod_forca')
  await gm.getByPlaceholder('1d20 + @mod_forca').press('Enter')

  await gm.getByRole('button', { name: /Detectar campos/ }).click()
  await gm.getByRole('button', { name: 'Mapa de campos' }).click()
  await expect(gm.getByRole('cell', { name: 'apelido' })).toBeVisible()
  await expect(gm.getByText('Salvo', { exact: true })).toBeVisible({ timeout: 5000 })

  // Personagem da jogadora, criado pelo mestre.
  await gm.goto(`/c/${id}/sheets`)
  await gm.getByRole('button', { name: 'Novo personagem' }).click()
  await gm.getByLabel('Nome', { exact: true }).fill('Lyra')
  await gm.locator('select[name=templateId]').selectOption({ label: 'ficha' })
  await gm.getByRole('checkbox', { name: 'Jogadora' }).check()
  await gm.getByRole('button', { name: 'Criar', exact: true }).click()
  await gm.waitForURL(/\/sheets\/[^/]+$/)
  const sheetUrl = gm.url()

  await player.goto(sheetUrl)
  await expect(player.getByLabel('forca', { exact: true })).toBeVisible({ timeout: 30_000 })
  await player.getByLabel('forca', { exact: true }).fill('16')
  await expect(gm.getByLabel('mod forca', { exact: true })).toHaveText('3', { timeout: 1000 })
  await expect(player.getByLabel('mod forca', { exact: true })).toHaveText('3')

  // Rolagem a partir da ficha sai no chat em nome do personagem (F6).
  await player.getByRole('button', { name: 'Rolar mod forca' }).click()
  await expect(gm.getByText('Lyra · mod_forca')).toBeVisible()

  // Exportar PDF preenchido (F13).
  const download = player.waitForEvent('download')
  await player.getByRole('button', { name: 'Baixar PDF preenchido' }).click()
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/)

  // O cartão inteiro abre a ficha, e Voltar leva de volta à lista.
  await player.goto(`/c/${id}/sheets`)
  await player.getByRole('link', { name: 'Abrir ficha de Lyra' }).click()
  await expect(player).toHaveURL(sheetUrl)
  await player.getByRole('link', { name: 'Voltar' }).click()
  await expect(player).toHaveURL(new RegExp(`/c/${id}/sheets$`))

  // Observador e outro jogador não abrem a ficha.
  const other = await signUp(browser, 'Outro')
  await other.goto(invite)
  await other.goto(sheetUrl)
  await expect(other.getByText('Ficha não encontrada')).toBeVisible()
})
