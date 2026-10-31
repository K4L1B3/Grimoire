'use server'
import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, asset, campaign, membership, scene, sheetTemplate } from '@grimorio/db'
import { requireGm, requireMember, requireUser } from '@/lib/session'

const newInvite = () => randomBytes(9).toString('base64url')
const name = z.string().trim().min(1, 'Dê um nome').max(80)

export async function createCampaign(rawName: string) {
  const user = await requireUser()
  const id = crypto.randomUUID()
  await db.transaction(async (tx) => {
    await tx.insert(campaign).values({ id, name: name.parse(rawName), ownerId: user.id, inviteCode: newInvite() })
    await tx.insert(membership).values({ campaignId: id, userId: user.id, role: 'gm' })
  })
  // Sistema da mesa é D&D 5e: fichas de personagem e de criatura já vêm prontas.
  return { id }
}

async function gmAsset(campaignId: string, assetId: string) {
  const [a] = await db.select().from(asset).where(and(eq(asset.id, assetId), eq(asset.campaignId, campaignId)))
  if (!a) throw new Error('Arquivo não encontrado')
  return a
}

export async function createTemplate(campaignId: string, pdfAssetId: string, rawName: string) {
  await requireGm(campaignId)
  await gmAsset(campaignId, pdfAssetId)
  const [t] = await db.insert(sheetTemplate).values({ campaignId, pdfAssetId, name: name.parse(rawName) }).returning({ id: sheetTemplate.id })
  revalidatePath(`/c/${campaignId}`, 'layout')
  return t!
}

// Arrastar a imagem cria a cena (SDD T1); a primeira cena já nasce ativa.
export async function createScene(campaignId: string, assetId: string, rawName: string, folderId: string | null = null) {
  await requireGm(campaignId)
  const a = await gmAsset(campaignId, assetId)
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(scene).where(and(eq(scene.campaignId, campaignId), eq(scene.active, true))) as [{ n: number }]
  const [s] = await db.insert(scene).values({ campaignId, assetId, name: name.parse(rawName), width: a.width ?? 2000, height: a.height ?? 2000, active: n === 0, sortOrder: Date.now(), folderId }).returning({ id: scene.id })
  revalidatePath(`/c/${campaignId}`, 'layout')
  return s!
}

export async function updateCampaign(campaignId: string, patch: { name?: string; coverAssetId?: string | null }) {
  const { user, campaign: c } = await requireMember(campaignId)
  if (user.id !== c.ownerId) throw new Error('Só o dono edita a campanha')
  if (patch.coverAssetId) await gmAsset(campaignId, patch.coverAssetId)
  await db.update(campaign).set({ ...patch, name: patch.name === undefined ? undefined : name.parse(patch.name) }).where(eq(campaign.id, campaignId))
  revalidatePath('/', 'layout')
}

export async function regenerateInvite(campaignId: string) {
  await requireGm(campaignId)
  await db.update(campaign).set({ inviteCode: newInvite() }).where(eq(campaign.id, campaignId))
  revalidatePath(`/c/${campaignId}/settings`)
}

export async function setRole(campaignId: string, userId: string, role: 'gm' | 'player' | 'observer') {
  const { campaign: c } = await requireGm(campaignId)
  if (userId === c.ownerId) throw new Error('O dono da campanha é sempre mestre')
  await db.update(membership).set({ role: z.enum(['gm', 'player', 'observer']).parse(role) }).where(and(eq(membership.campaignId, campaignId), eq(membership.userId, userId)))
  revalidatePath(`/c/${campaignId}/settings`)
}

export async function removeMember(campaignId: string, userId: string) {
  const { campaign: c } = await requireGm(campaignId)
  if (userId === c.ownerId) throw new Error('Não dá para remover o dono')
  await db.delete(membership).where(and(eq(membership.campaignId, campaignId), eq(membership.userId, userId)))
  revalidatePath(`/c/${campaignId}/settings`)
}

export async function leaveCampaign(campaignId: string) {
  const { user, campaign: c } = await requireMember(campaignId)
  if (user.id === c.ownerId) throw new Error('O dono não pode sair; apague a campanha')
  await db.delete(membership).where(and(eq(membership.campaignId, campaignId), eq(membership.userId, user.id)))
  redirect('/')
}

export async function deleteCampaign(campaignId: string) {
  const { user, campaign: c } = await requireMember(campaignId)
  if (user.id !== c.ownerId) throw new Error('Só o dono apaga a campanha')
  await db.delete(campaign).where(and(eq(campaign.id, campaignId), eq(campaign.ownerId, user.id)))
  redirect('/')
}

export async function setDicePrefs(campaignId: string, prefs: { diceColor?: string; dice3d?: boolean }) {
  const { user } = await requireMember(campaignId)
  const p = z.object({ diceColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), dice3d: z.boolean().optional() }).parse(prefs)
  await db.update(membership).set(p).where(and(eq(membership.campaignId, campaignId), eq(membership.userId, user.id), ne(membership.role, 'observer')))
}
