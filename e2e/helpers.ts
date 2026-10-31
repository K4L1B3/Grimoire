import path from 'node:path'
import { io } from '../apps/web/node_modules/socket.io-client'
import { expect, type Browser, type Page } from '@playwright/test'

export const fixture = (name: string) => path.join(__dirname, 'fixtures', name)

export async function signUp(browser: Browser, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto('/login')
  await page.getByRole('button', { name: /Criar conta/ }).click()
  await page.getByLabel('Nome').fill(name)
  await page.getByLabel('Email').fill(`${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@teste.dev`)
  await page.getByLabel('Senha').fill('senha-forte-123')
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click()
  await expect(page.getByText('Suas campanhas')).toBeVisible({ timeout: 30_000 })
  // Modal do primeiro acesso: fica com o avatar padrão.
  await page.getByRole('dialog').getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  return page
}

// Cria campanha pelo assistente (com ficha e mapa) e devolve id e link de convite.
export async function createCampaign(gm: Page, name = 'Masmorra Cruel') {
  await gm.goto('/new')
  await gm.getByPlaceholder('A Masmorra Cruel').fill(name)
  await gm.getByRole('button', { name: 'Continuar' }).click()
  await gm.locator('input[type=file]').setInputFiles(fixture('ficha.pdf'))
  await expect(gm.getByRole('heading', { name: 'E o primeiro mapa?' })).toBeVisible()
  await gm.locator('input[type=file]').setInputFiles(fixture('mapa.png'))
  await expect(gm.getByRole('heading', { name: 'Quer uma capa?' })).toBeVisible({ timeout: 20_000 })
  await gm.getByRole('button', { name: 'Pular' }).click()
  const invite = await gm.locator('input[readonly]').inputValue({ timeout: 20_000 })
  await gm.getByRole('link', { name: 'Abrir a mesa' }).click()
  await gm.waitForURL(/\/c\/[^/]+\/play/)
  const id = gm.url().split('/c/')[1]!.split('/')[0]!
  return { id, invite }
}

// Guarda os frames recebidos pelo WebSocket da página, para provar o que trafega (ou não) até o jogador.
export function captureFrames(page: Page) {
  const frames: string[] = []
  page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))))
  return frames
}

// Socket.IO direto do teste, com a sessão de uma página (para testar o que o servidor recusa).
export async function rawSocket(page: Page, campaignId: string) {
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
  const s = io('http://localhost:4010', { path: '/rt/socket.io', extraHeaders: { cookie, origin: 'http://localhost:3010' }, auth: { campaignId } })
  await new Promise<void>((r) => s.on('connect', () => r()))
  return s
}

// Abre uma categoria da biblioteca (barra embaixo do mapa) e arrasta um item para o tabuleiro.
export async function dragFromLibrary(page: Page, category: string, name: string, x: number, y: number) {
  const bar = page.getByRole('toolbar', { name: 'Biblioteca' })
  const btn = bar.getByRole('button', { name: category })
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click()
  await page.locator('li[data-tile]', { hasText: name }).dragTo(page.getByTestId('board'), { targetPosition: { x, y } })
}

// Responde a caixa de texto do app (no lugar do prompt() do navegador).
export async function answer(page: Page, text: string) {
  const box = page.locator('dialog[open]')
  await box.locator('input').fill(text)
  await box.getByRole('button', { name: 'Confirmar' }).click()
}
