import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { answer, createCampaign, fixture, rawSocket, signUp } from './helpers'

async function openNotes(p: Page, campaignId: string) {
  await p.goto(`/c/${campaignId}/play`)
  await p.getByRole('toolbar', { name: 'Biblioteca' }).getByRole('button', { name: 'Notas' }).click()
}

async function createNote(p: Page, title: string, text: string) {
  await p.getByRole('button', { name: 'Nota', exact: true }).click()
  await answer(p, title)
  const editor = p.locator('.wiki-prose').first()
  await editor.click()
  await p.keyboard.type(text)
  await p.waitForTimeout(2500) // Hocuspocus salva com debounce
}

test('notas: a do jogador é só dele, a do mestre só aparece quando ele mostra', async ({ browser }) => {
  test.setTimeout(300_000) // Modo dev: três navegadores compilando sob demanda.
  const gm = await signUp(browser, 'Mestre')
  const { id, invite } = await createCampaign(gm)
  const player = await signUp(browser, 'Jogadora')
  await player.goto(invite)
  await player.waitForURL(/\/c\//)
  const other = await signUp(browser, 'Outra')
  await other.goto(invite)
  await other.waitForURL(/\/c\//)

  // Jogadora cria a própria nota; ela persiste para a dona.
  await openNotes(player, id)
  await createNote(player, 'Diário da Jogadora', 'Desconfio do taverneiro')
  await openNotes(player, id)
  await expect(player.locator('li[data-tile]', { hasText: 'Diário da Jogadora' })).toBeVisible()
  await player.locator('li[data-tile]', { hasText: 'Diário da Jogadora' }).getByRole('button', { name: 'Diário da Jogadora', exact: true }).click()
  await expect(player.locator('.wiki-prose').first()).toContainText('Desconfio do taverneiro')

  // Nem mestre nem outro jogador acham: árvore, busca, leitura, edição, exclusão e exportação.
  const ps = await rawSocket(player, id)
  const note = ((await ps.emitWithAck('wiki:tree', {})).data.pages as { id: string; title: string }[]).find((p) => p.title === 'Diário da Jogadora')!
  for (const [p, name] of [[gm, 'mestre'], [other, 'outra']] as const) {
    const sock = await rawSocket(p, id)
    const tree = (await sock.emitWithAck('wiki:tree', {})).data.pages as { id: string }[]
    expect(tree.some((x) => x.id === note.id), name).toBe(false)
    expect((await sock.emitWithAck('wiki:search', { q: 'taverneiro' })).data, name).toEqual([])
    expect((await sock.emitWithAck('wiki:backlinks', { id: note.id })).ok, name).toBe(false)
    expect((await sock.emitWithAck('page:update', { id: note.id, patch: { title: 'x' } })).ok, name).toBe(false)
    expect((await sock.emitWithAck('page:delete', { id: note.id })).ok, name).toBe(false)
    expect((await sock.emitWithAck('page:show', { id: note.id })).ok, name).toBe(false)
    sock.disconnect()
  }
  await gm.goto(`/c/${id}/wiki/${note.id}`)
  await gm.waitForTimeout(3000)
  await expect(gm.locator('.wiki-prose')).toHaveCount(0)
  await expect(gm.getByText('Diário da Jogadora')).toHaveCount(0)
  const zip = await gm.request.get(`/c/${id}/wiki/export`)
  expect(zip.ok()).toBe(true)
  expect((await zip.body()).toString('latin1')).not.toContain('Di%C3%A1rio')
  expect((await zip.body()).toString('utf8')).not.toContain('Diário da Jogadora')

  // Jogadora não burla: não cria quadro nem copia modelo, e nota não vira filha de página da wiki.
  const gs = await rawSocket(gm, id)
  const wikiPage = (await gs.emitWithAck('page:create', { title: 'Lore' })).data.id as string
  expect((await ps.emitWithAck('page:create', { title: 'q', kind: 'board' })).ok).toBe(false)
  expect((await ps.emitWithAck('page:create', { title: 'q', fromTemplate: wikiPage })).ok).toBe(false)
  const child = (await ps.emitWithAck('page:create', { title: 'Filha', parentId: wikiPage })).data.id as string
  await gs.emitWithAck('page:delete', { id: wikiPage })
  expect(((await ps.emitWithAck('wiki:tree', {})).data.pages as { id: string }[]).some((p) => p.id === child)).toBe(true)
  await ps.emitWithAck('page:delete', { id: child })

  // Mestre cria a nota dele: oculta até ele mostrar.
  await openNotes(gm, id)
  await createNote(gm, 'Carta do Rei', 'O rei pede socorro')
  await openNotes(player, id)
  await expect(player.getByRole('button', { name: 'Carta do Rei' })).toHaveCount(0)

  // Mostrar abre a janela na tela do jogador, que passa a ler (sem editar).
  const tile = gm.locator('li[data-tile]', { hasText: 'Carta do Rei' })
  await tile.hover()
  await tile.getByRole('button', { name: 'Mostrar aos jogadores' }).click()
  const shown = player.locator('.wiki-prose', { hasText: 'O rei pede socorro' })
  await expect(shown).toBeVisible({ timeout: 20_000 })
  await expect(shown).toHaveAttribute('contenteditable', 'false')
  await expect(player.locator('li[data-tile]', { hasText: 'Carta do Rei' })).toBeVisible()

  // Ocultar tira de novo.
  await tile.hover()
  await tile.getByRole('button', { name: 'Ocultar dos jogadores' }).click()
  await expect(player.locator('li[data-tile]', { hasText: 'Carta do Rei' })).toHaveCount(0)

  // A nota da jogadora continua lá, e ela renomeia e apaga pela biblioteca.
  const mine = player.locator('li[data-tile]', { hasText: 'Diário da Jogadora' })
  await mine.hover()
  await mine.getByRole('button', { name: 'Apagar Diário da Jogadora' }).click()
  await player.locator('dialog[open]').getByRole('button', { name: 'Apagar' }).click()
  await expect(mine).toHaveCount(0)
  ps.disconnect()
  gs.disconnect()
})

test('notas: pastas são pessoais, nota da wiki só entra se o mestre indicar e é só leitura', async ({ browser }) => {
  test.setTimeout(300_000)
  const gm = await signUp(browser, 'Mestre')
  const { id, invite } = await createCampaign(gm)
  const player = await signUp(browser, 'Jogadora')
  await player.goto(invite)
  await player.waitForURL(/\/c\//)
  const gs = await rawSocket(gm, id)
  const ps = await rawSocket(player, id)

  // Página visível da wiki não entra em Notas até o mestre indicar; "editável" não libera a escrita.
  const lore = (await gs.emitWithAck('page:create', { title: 'Lore do Reino' })).data.id as string
  await gs.emitWithAck('page:update', { id: lore, patch: { visibility: 'editable' } })
  const tile = player.locator('li[data-tile]', { hasText: 'Lore do Reino' })
  await openNotes(player, id)
  await expect(player.getByRole('button', { name: 'Pasta' })).toBeVisible()
  await expect(tile).toHaveCount(0)
  await gs.emitWithAck('page:update', { id: lore, patch: { inNotes: true } })
  await expect(tile).toBeVisible()
  await tile.getByRole('button', { name: 'Lore do Reino', exact: true }).click()
  await expect(player.locator('.wiki-prose').first()).toHaveAttribute('contenteditable', 'false')
  expect((await ps.emitWithAck('page:update', { id: lore, patch: { inNotes: false } })).ok).toBe(false)

  // Nota da jogadora fica fora da wiki, mesmo para ela.
  await openNotes(player, id)
  await createNote(player, 'Diário', 'Só meu')
  await player.goto(`/c/${id}/wiki`)
  await expect(player.getByRole('link', { name: 'Lore do Reino' })).toBeVisible()
  await expect(player.getByRole('link', { name: 'Diário' })).toHaveCount(0)
  expect((await ps.emitWithAck('wiki:search', { q: 'Só meu' })).data).toEqual([])

  // Ela guarda a página da wiki numa pasta: o caminho muda só para ela.
  await openNotes(player, id)
  await player.getByRole('button', { name: 'Pasta', exact: true }).click()
  await answer(player, 'Campanha')
  const folder = player.locator('li[data-tile]', { hasText: 'Campanha' })
  await tile.dragTo(folder)
  await expect(tile).toHaveCount(0)
  await folder.click()
  await expect(tile).toBeVisible()
  await player.reload()
  await player.getByRole('toolbar', { name: 'Biblioteca' }).getByRole('button', { name: 'Notas' }).click()
  await expect(folder).toBeVisible()
  await expect(tile).toHaveCount(0)
  const pages = (await gs.emitWithAck('wiki:tree', {})).data.pages as { id: string; parentId: string | null }[]
  expect(pages.find((p) => p.id === lore)?.parentId).toBeNull()
  await openNotes(gm, id)
  await expect(gm.locator('li[data-tile]', { hasText: 'Lore do Reino' })).toBeVisible()
  await expect(gm.locator('li[data-tile]', { hasText: 'Campanha' })).toHaveCount(0)

  // Apagar a pasta devolve o que estava dentro, e tirar de Notas não apaga a página da wiki.
  await folder.hover()
  await folder.getByRole('button', { name: 'Apagar pasta' }).click()
  await player.locator('dialog[open]').getByRole('button', { name: 'Apagar' }).click()
  await expect(tile).toBeVisible()
  const gmTile = gm.locator('li[data-tile]', { hasText: 'Lore do Reino' })
  await gmTile.hover()
  await gmTile.getByRole('button', { name: 'Tirar de Notas' }).click()
  await expect(tile).toHaveCount(0)
  expect(((await gs.emitWithAck('wiki:tree', {})).data.pages as { id: string }[]).some((p) => p.id === lore)).toBe(true)
  ps.disconnect()
  gs.disconnect()
})

test('nota: editor sem borda de foco e imagem por botão, colar e soltar', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id } = await createCampaign(gm)
  await openNotes(gm, id)
  await createNote(gm, 'Com imagens', 'Texto da nota')
  const editor = gm.locator('.wiki-prose').first()
  await expect(editor).toHaveCSS('outline-style', 'none')

  const imgs = editor.locator('img')
  const chooser = gm.waitForEvent('filechooser')
  await gm.getByRole('button', { name: 'Imagem', exact: true }).click()
  await (await chooser).setFiles(fixture('mapa.png'))
  await expect(imgs).toHaveCount(1)
  await expect.poll(() => imgs.first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)

  const send = (type: 'paste' | 'drop', text = '') => editor.evaluate(async (el, { type, text, bytes }) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], 'x.png', { type: 'image/png' }))
    if (text) dt.setData('text/plain', text)
    const r = el.getBoundingClientRect()
    el.dispatchEvent(type === 'paste'
      ? new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      : new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10 }))
  }, { type, text, bytes: [...readFileSync(fixture('mapa.png'))] })

  await send('paste')
  await expect(imgs).toHaveCount(2)
  await send('drop')
  await expect(imgs).toHaveCount(3)
  // Word e Excel mandam texto com um print dele: entra o texto, não a imagem.
  await send('paste', 'tabela do word')
  await expect(editor).toContainText('tabela do word')
  await expect(imgs).toHaveCount(3)

  await gm.waitForTimeout(2500) // Hocuspocus salva com debounce
  await gm.reload()
  await expect(gm.locator('.wiki-prose').first().locator('img')).toHaveCount(3, { timeout: 20_000 })
})
