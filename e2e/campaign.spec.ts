import { test, expect } from '@playwright/test'
import { createCampaign, signUp } from './helpers'

test('mestre cria campanha pelo assistente e jogador entra pelo convite', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id, invite } = await createCampaign(gm)
  expect(invite).toMatch(/\/join\//)

  const player = await signUp(browser, 'Jogadora')
  await player.goto(invite)
  await player.waitForURL(new RegExp(`/c/${id}/play`))

  await gm.goto(`/c/${id}/settings`)
  await expect(gm.getByText('Jogadora', { exact: true })).toBeVisible()
  await player.goto('/')
  await expect(player.getByText('Masmorra Cruel')).toBeVisible()
})

test('quem não é membro não vê a campanha', async ({ browser }) => {
  const gm = await signUp(browser, 'Mestre')
  const { id } = await createCampaign(gm)
  const stranger = await signUp(browser, 'Estranho')
  const res = await stranger.goto(`/c/${id}/settings`)
  expect(res?.status()).toBe(404)
})

test('inglês pelo navegador e troca de idioma no menu', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en-US' })
  const page = await ctx.newPage()
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await ctx.addCookies([{ name: 'locale', value: 'pt', url: page.url() }])
  await page.reload()
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible()
})
