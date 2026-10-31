import { test, expect, type Page } from '@playwright/test'
import { captureFrames, createCampaign, fixture, rawSocket, signUp } from './helpers'

async function newPage(gm: Page, kind = 'Página') {
  await gm.getByRole('button', { name: 'Nova página' }).click()
  await gm.getByRole('button', { name: kind, exact: true }).click()
  await gm.waitForURL(/\/wiki\/[0-9a-f-]{36}/)
}

test('wiki: links, backlinks, segredo fora da rede do jogador, colaboração e exportar', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id, invite } = await createCampaign(gm)
  const player = await signUp(browser, 'Jogadora')
  await player.goto(invite)

  await gm.goto(`/c/${id}/wiki`)
  await newPage(gm)
  await gm.getByLabel('Título da página').fill('Cidade de Prata')
  await gm.getByLabel('Título da página').press('Enter')
  const editor = gm.locator('.wiki-prose').first()
  await editor.click()
  await gm.keyboard.type('A cidade fica no vale. Dono da taverna: ')
  // [[ cria a página na hora e vira chip (W4).
  await gm.keyboard.type('[[Taverna do Corvo')
  await gm.getByRole('option', { name: /Criar página/ }).click()
  await expect(editor.getByRole('link', { name: 'Taverna do Corvo' })).toBeVisible()
  // Bloco secreto pelo menu / (W6).
  await gm.keyboard.press('Enter')
  await gm.keyboard.type('/Bloco')
  await gm.getByRole('option', { name: /Bloco secreto/ }).click()
  const secret = gm.getByTestId('secret').locator('.wiki-prose')
  await expect(secret).toBeVisible()
  await secret.click()
  await gm.keyboard.type('O prefeito é um vampiro')
  const cidadeUrl = gm.url()
  await gm.waitForTimeout(2500) // Hocuspocus salva com debounce

  // Backlink e renomear (W5, critério: renomear não quebra link).
  await gm.getByRole('link', { name: 'Taverna do Corvo' }).first().click()
  await expect(gm.getByText('Citada em')).toBeVisible({ timeout: 20_000 })
  await gm.getByLabel('Título da página').fill('Taverna do Corvo Negro')
  await gm.getByLabel('Título da página').press('Enter')
  await gm.goto(cidadeUrl)
  await expect(gm.locator('.wiki-prose').first().getByRole('link', { name: 'Taverna do Corvo Negro' })).toBeVisible()

  // Libera a página para jogadores.
  const gs = await rawSocket(gm, id)
  const tree = (await gs.emitWithAck('wiki:tree', {})).data.pages as { id: string; title: string }[]
  const cidade = tree.find((p) => p.title === 'Cidade de Prata')!
  await gs.emitWithAck('page:update', { id: cidade.id, patch: { visibility: 'visible' } })

  const frames = captureFrames(player)
  await player.goto(cidadeUrl)
  await expect(player.getByText('A cidade fica no vale.')).toBeVisible({ timeout: 20_000 })
  await expect(player.locator('.wiki-prose').first().getByText('página oculta')).toBeVisible()
  await player.waitForTimeout(1000)
  expect(frames.some((f) => f.includes('vampiro'))).toBe(false)
  expect(await player.getByText('vampiro').count()).toBe(0)
  const ps = await rawSocket(player, id)
  expect((await ps.emitWithAck('wiki:search', { q: 'vampiro' })).data).toEqual([])
  expect((await gs.emitWithAck('wiki:search', { q: 'vampiro' })).data[0].secret).toBe(true)
  // Jogadora não edita página só visível.
  expect(await player.locator('.wiki-prose').first().getAttribute('contenteditable')).toBe('false')

  // Duas abas do mestre, uma offline: as duas convergem ao reconectar (critério W3).
  const ctx2 = await browser.newContext({ storageState: await gm.context().storageState() })
  const tab2 = await ctx2.newPage()
  await tab2.goto(cidadeUrl)
  await expect(tab2.getByText('A cidade fica no vale.')).toBeVisible({ timeout: 20_000 })
  await ctx2.setOffline(true)
  await tab2.locator('.wiki-prose').first().click()
  await tab2.keyboard.press('Control+End')
  await tab2.keyboard.type(' Texto escrito offline.')
  await gm.locator('.wiki-prose').first().click()
  await gm.keyboard.press('Control+Home')
  await gm.keyboard.type('Enquanto isso, online. ')
  await tab2.waitForTimeout(3000)
  await ctx2.setOffline(false)
  await expect(tab2.getByText('Enquanto isso, online.')).toBeVisible({ timeout: 20_000 })
  await expect(gm.getByText('Texto escrito offline.')).toBeVisible({ timeout: 20_000 })

  // Exportar e reimportar reproduz árvore e links (W12).
  await gm.waitForTimeout(2500)
  const res = await gm.request.get(`/c/${id}/wiki/export`)
  expect(res.headers()['content-type']).toBe('application/zip')
  const zip = await res.body()
  const imported = await gm.request.post(`/c/${id}/wiki/export`, { multipart: { file: { name: 'w.zip', mimeType: 'application/zip', buffer: zip } } })
  expect((await imported.json()).pages).toBe(2)
  const after = (await gs.emitWithAck('wiki:tree', {})).data.pages as { id: string; title: string }[]
  expect(after.filter((p) => p.title === 'Cidade de Prata')).toHaveLength(2)
  const copy = after.find((p) => p.title === 'Cidade de Prata' && p.id !== cidade.id)!
  await gm.goto(`/c/${id}/wiki/${copy.id}`)
  const chip = gm.locator('.wiki-prose').first().getByRole('link', { name: 'Taverna do Corvo Negro' })
  await expect(chip).toBeVisible({ timeout: 20_000 })
  expect(after.map((p) => p.id)).toContain((await chip.getAttribute('href'))!.split('/').pop())
  expect(await chip.getAttribute('href')).not.toContain(tree.find((p) => p.title.startsWith('Taverna'))!.id)
  ps.close()
  gs.close()
})

test('wiki: mapa com pin e quadro', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id } = await createCampaign(gm)
  await gm.goto(`/c/${id}/wiki`)
  await newPage(gm, 'Mapa')
  await gm.locator('article input[type=file]').setInputFiles(fixture('mapa.png'))
  await expect(gm.getByTestId('world-map')).toBeVisible({ timeout: 20_000 })
  await gm.getByRole('button', { name: 'Pôr pin' }).click()
  await gm.getByTestId('world-map').click({ position: { x: 200, y: 150 } })
  await gm.getByLabel('Nome do pin').fill('Torre')
  await gm.getByLabel('Nome do pin').blur()
  await expect(gm.getByRole('button', { name: 'Torre' })).toBeVisible()
  await gm.getByRole('button', { name: 'castle', exact: true }).click()
  await expect(gm.getByRole('button', { name: 'Torre' }).locator('svg.lucide-castle')).toBeVisible()

  await newPage(gm, 'Quadro')
  await expect(gm.locator('.excalidraw')).toBeVisible({ timeout: 30_000 })

  // W17: no quadro visível, cartão de página oculta chega ao jogador sem o título.
  const boardId = gm.url().split('/').pop()!
  const gs = await rawSocket(gm, id)
  const secretPage = (await gs.emitWithAck('page:create', { title: 'Plano do Lich', kind: 'text' })).data.id
  await gs.emitWithAck('page:update', { id: boardId, patch: { visibility: 'visible' } })
  await gs.emitWithAck('board:update', { pageId: boardId, elements: [{ id: 'card-text', type: 'text', version: 1, text: 'Plano do Lich', originalText: 'Plano do Lich', customData: { pageId: secretPage } }] })
  const player = await signUp(browser, 'Jogadora')
  const frames = captureFrames(player)
  await player.goto((await gm.request.get(`/c/${id}/invite`)).ok() ? `/join/${await (await gm.request.get(`/c/${id}/invite`)).text()}` : '/')
  const ps = await rawSocket(player, id)
  const view = (await ps.emitWithAck('board:join', { pageId: boardId })).data
  expect(view.elements[0].text).toBe('Página oculta')
  expect(JSON.stringify(view).includes('Lich')).toBe(false)
  await player.goto(`/c/${id}/wiki/${boardId}`)
  await expect(player.locator('.excalidraw')).toBeVisible({ timeout: 30_000 })
  expect(frames.some((f) => f.includes('Lich'))).toBe(false)
  ps.close()
  gs.close()
})

test('wiki: pasta agrupa qualquer tipo de página e, apagada, não leva o conteúdo', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id } = await createCampaign(gm)
  await gm.goto(`/c/${id}/wiki`)
  await newPage(gm, 'Pasta')
  await expect(gm.getByText('Pasta vazia')).toBeVisible()
  const folder = gm.url().split('/wiki/')[1]!

  const gs = await rawSocket(gm, id)
  for (const kind of ['text', 'map', 'timeline', 'board']) await gs.emitWithAck('page:create', { title: kind, kind, parentId: folder })
  await expect(gm.locator('article').getByRole('link', { name: 'timeline' })).toBeVisible()

  expect((await gs.emitWithAck('page:delete', { id: folder })).ok).toBe(true)
  const pages = (await gs.emitWithAck('wiki:tree', {})).data.pages as { kind: string; parentId: string | null }[]
  expect(pages.filter((p) => ['text', 'map', 'timeline', 'board'].includes(p.kind)).every((p) => p.parentId === null)).toBe(true)
  expect(pages.some((p) => p.kind === 'folder')).toBe(false)
  gs.close()
})
