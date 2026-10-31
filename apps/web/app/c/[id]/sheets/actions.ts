'use server'
import { revalidatePath } from 'next/cache'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db, actor, asset, membership, sheet, sheetTemplate } from '@grimorio/db'
import { slugify, type Field } from '@grimorio/core'
import { requireGm, requireMember } from '@/lib/session'

const name = z.string().trim().min(1, 'Dê um nome').max(80)

async function template(campaignId: string, templateId: string) {
  const [t] = await db.select({ id: sheetTemplate.id }).from(sheetTemplate).where(and(eq(sheetTemplate.id, templateId), eq(sheetTemplate.campaignId, campaignId)))
  if (!t) throw new Error('Molde não encontrado')
  return t
}

// Mestre ou dono do ator.
async function ownActor(campaignId: string, actorId: string) {
  const ctx = await requireMember(campaignId)
  const [a] = await db.select().from(actor).where(and(eq(actor.id, actorId), eq(actor.campaignId, campaignId)))
  if (!a || (ctx.member.role !== 'gm' && !a.ownerIds.includes(ctx.user.id))) throw new Error('Personagem não encontrado')
  return { ...ctx, actor: a }
}

// Valores iniciais de uma ficha nova: o que o molde define como padrão.
const defaults = (fields: Field[]) => Object.fromEntries(fields.filter((f) => f.default !== undefined && !f.formula).map((f) => [f.name, f.default]))

async function validOwners(campaignId: string, ids: string[]) {
  if (!ids.length) return []
  const rows = await db.select({ id: membership.userId }).from(membership).where(and(eq(membership.campaignId, campaignId), inArray(membership.userId, ids)))
  return rows.map((r) => r.id)
}

// kind: personagem de jogador ou criatura (biblioteca). Sem molde escolhido, usa o PDF importado se houver só um;
// com vários (ou nenhum), nasce sem ficha e a pessoa escolhe na janela Fichas. templateId '' cria sem ficha (NPC simples).
export async function createActor(campaignId: string, input: { name: string; ownerIds?: string[]; templateId?: string; kind?: 'character' | 'creature'; folderId?: string | null }) {
  const { member, user } = await requireMember(campaignId)
  if (member.role === 'observer') throw new Error('Observador não cria personagem')
  const kind = member.role === 'gm' ? (input.kind ?? 'character') : 'character'
  // Jogador cria o próprio personagem; o mestre escolhe os donos (ou nenhum, para criatura).
  const ownerIds = member.role === 'gm' ? await validOwners(campaignId, input.ownerIds ?? []) : [user.id]
  let templateId = input.templateId
  if (templateId === undefined) {
    const own = await db.select({ id: sheetTemplate.id }).from(sheetTemplate).where(and(eq(sheetTemplate.campaignId, campaignId), isNull(sheetTemplate.builtin)))
    templateId = own.length === 1 ? own[0]!.id : ''
  }
  if (templateId) await template(campaignId, templateId)
  const [a] = await db.insert(actor).values({ campaignId, name: name.parse(input.name), ownerIds, kind, folderId: input.folderId ?? null }).returning()
  let sheetId: string | undefined
  if (templateId) {
    const [tpl] = await db.select({ fields: sheetTemplate.fields }).from(sheetTemplate).where(eq(sheetTemplate.id, templateId))
    const values = { ...defaults(tpl!.fields as Field[]), nome: a!.name }
    ;[{ id: sheetId }] = await db.insert(sheet).values({ templateId, actorId: a!.id, ownerIds, values }).returning({ id: sheet.id }) as [{ id: string }]
  }
  revalidatePath(`/c/${campaignId}`, 'layout')
  return { id: a!.id, sheetId }
}

export async function updateActor(campaignId: string, actorId: string, patch: { name?: string; ownerIds?: string[]; avatarAssetId?: string | null }) {
  const { member } = await ownActor(campaignId, actorId)
  const set: Partial<typeof actor.$inferInsert> = {}
  if (patch.name !== undefined) set.name = name.parse(patch.name)
  if (patch.avatarAssetId) {
    const [a] = await db.select({ id: asset.id }).from(asset).where(and(eq(asset.id, patch.avatarAssetId), eq(asset.campaignId, campaignId)))
    if (!a) throw new Error('Imagem não encontrada')
    set.avatarAssetId = a.id
  }
  if (patch.ownerIds && member.role === 'gm') set.ownerIds = await validOwners(campaignId, patch.ownerIds)
  await db.transaction(async (tx) => {
    await tx.update(actor).set(set).where(eq(actor.id, actorId))
    if (set.ownerIds) await tx.update(sheet).set({ ownerIds: set.ownerIds }).where(eq(sheet.actorId, actorId))
  })
  revalidatePath(`/c/${campaignId}`, 'layout')
}

export async function deleteActor(campaignId: string, actorId: string) {
  await ownActor(campaignId, actorId)
  await db.delete(actor).where(eq(actor.id, actorId))
  revalidatePath(`/c/${campaignId}`, 'layout')
}

// Várias fichas por ator (F12): a principal sem apelido, as outras com apelido (companheiro, montaria…).
export async function addSheet(campaignId: string, actorId: string, templateId: string, alias: string) {
  const { actor: a } = await ownActor(campaignId, actorId)
  await template(campaignId, templateId)
  const al = slugify(alias) || null
  // O índice único não pega apelido nulo (null ≠ null no Postgres), então a ficha principal é checada aqui.
  const [taken] = await db.select({ id: sheet.id }).from(sheet).where(and(eq(sheet.actorId, actorId), al ? eq(sheet.alias, al) : isNull(sheet.alias)))
  if (taken) throw new Error(al ? `Já existe a ficha "${al}" nesse personagem` : 'Esse personagem já tem ficha principal; dê um apelido (ex.: companheiro)')
  const [tpl] = await db.select({ fields: sheetTemplate.fields }).from(sheetTemplate).where(eq(sheetTemplate.id, templateId))
  const [s] = await db.insert(sheet).values({ templateId, actorId, alias: al, ownerIds: a.ownerIds, values: defaults(tpl!.fields as Field[]) }).returning({ id: sheet.id })
  revalidatePath(`/c/${campaignId}/sheets`)
  return s!
}

export async function deleteSheet(campaignId: string, sheetId: string) {
  const [s] = await db.select({ actorId: sheet.actorId }).from(sheet).innerJoin(sheetTemplate, eq(sheetTemplate.id, sheet.templateId)).where(and(eq(sheet.id, sheetId), eq(sheetTemplate.campaignId, campaignId)))
  if (!s) throw new Error('Ficha não encontrada')
  if (s.actorId) await ownActor(campaignId, s.actorId)
  else await requireGm(campaignId)
  await db.delete(sheet).where(eq(sheet.id, sheetId))
  revalidatePath(`/c/${campaignId}/sheets`)
}

export async function deleteTemplate(campaignId: string, templateId: string) {
  await requireGm(campaignId)
  await template(campaignId, templateId)
  await db.transaction(async (tx) => {
    await tx.delete(sheet).where(eq(sheet.templateId, templateId))
    await tx.delete(sheetTemplate).where(eq(sheetTemplate.id, templateId))
  })
  revalidatePath(`/c/${campaignId}/sheets`)
}
