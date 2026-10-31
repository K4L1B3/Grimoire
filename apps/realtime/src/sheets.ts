// Fichas ao vivo (F9, F10): o servidor valida cada campo e repassa só para quem tem a ficha aberta.
import { z } from 'zod'
import { and, eq, sql } from 'drizzle-orm'
import { db, actor, sheet, sheetNote, sheetTemplate } from '@grimorio/db'
import { can, computeSheet, FieldsSchema, numeric, reconcileValues, type Field } from '@grimorio/core'
import { handler, refreshMember, type IO, type S } from './ctx.ts'

const SheetId = z.object({ sheetId: z.string() })
const Value = z.union([z.string().max(20_000), z.number(), z.boolean(), z.null(), z.array(z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]))).max(200)])
const SetValue = z.object({ sheetId: z.string(), name: z.string().max(40), value: Value })
const Note = z.object({ sheetId: z.string(), data: z.object({ strokes: z.array(z.object({ page: z.number().int(), color: z.string().max(20), points: z.array(z.number()).max(4000) })).max(500), texts: z.array(z.object({ page: z.number().int(), x: z.number(), y: z.number(), text: z.string().max(2000) })).max(200) }) })
const Save = z.object({ templateId: z.string(), fields: FieldsSchema, name: z.string().trim().min(1).max(80).optional() })

export async function loadSheet(campaignId: string, sheetId: string) {
  const [row] = await db
    .select({ sheet, actorName: actor.name, actorOwners: actor.ownerIds, template: sheetTemplate })
    .from(sheet)
    .innerJoin(sheetTemplate, eq(sheetTemplate.id, sheet.templateId))
    .leftJoin(actor, eq(actor.id, sheet.actorId))
    .where(and(eq(sheet.id, sheetId), eq(sheetTemplate.campaignId, campaignId)))
  if (!row) return null
  return { ...row, ownerIds: [...new Set([...row.sheet.ownerIds, ...(row.actorOwners ?? [])])] }
}

// Ver a ficha: mestre e donos. Observador não vê ficha (matriz §3).
const canView = (s: S, ownerIds: string[]) => s.data.member.role === 'gm' || (s.data.member.role === 'player' && ownerIds.includes(s.data.member.userId))

// Avisado quando uma ficha muda; o tabuleiro usa para atualizar barras e combate.
type Listener = (io: IO, campaignId: string, actorId: string) => void
const listeners: Listener[] = []
export const onSheetChange = (fn: Listener) => listeners.push(fn)

export function registerSheets(io: IO, s: S) {
  const { campaignId } = s.data

  s.on('sheet:join', handler(SheetId.parse, async ({ sheetId }) => {
    const member = await refreshMember(s)
    const row = await loadSheet(campaignId, sheetId)
    if (!member || !row || !canView(s, row.ownerIds)) throw new Error('Ficha não encontrada')
    s.join([`sheet:${sheetId}`, `tpl:${row.template.id}`])
    const [note] = await db.select({ data: sheetNote.data }).from(sheetNote).where(and(eq(sheetNote.sheetId, sheetId), eq(sheetNote.userId, member.userId)))
    // Valores das outras fichas do mesmo ator, para fórmulas como @companheiro.forca (F5).
    const refs: Record<string, number> = {}
    if (row.sheet.actorId) {
      const others = await db.select({ id: sheet.id, alias: sheet.alias, values: sheet.values, fields: sheetTemplate.fields }).from(sheet).innerJoin(sheetTemplate, eq(sheetTemplate.id, sheet.templateId)).where(eq(sheet.actorId, row.sheet.actorId))
      for (const o of others) {
        if (o.id === sheetId || !o.alias) continue
        for (const [k, v] of Object.entries(computeSheet(o.fields as Field[], numeric(o.values as Record<string, unknown>)).values)) refs[`${o.alias}.${k}`] = v
      }
    }
    return {
      id: sheetId,
      actorId: row.sheet.actorId,
      title: [row.actorName, row.sheet.alias].filter(Boolean).join(' · ') || row.template.name,
      values: row.sheet.values,
      refs,
      canEdit: can(member, 'sheet.edit', { ownerIds: row.ownerIds }),
      template: { id: row.template.id, name: row.template.name, pdfAssetId: row.template.pdfAssetId, fields: row.template.fields },
      note: note?.data ?? { strokes: [], texts: [] },
    }
  }))

  s.on('sheet:leave', handler(SheetId.parse, async ({ sheetId }) => void s.leave(`sheet:${sheetId}`)))

  s.on('sheet:set', handler(SetValue.parse, async ({ sheetId, name, value }) => {
    const member = await refreshMember(s)
    const row = await loadSheet(campaignId, sheetId)
    if (!member || !row || !can(member, 'sheet.edit', { ownerIds: row.ownerIds })) throw new Error('Você não pode editar essa ficha')
    const field = (row.template.fields as Field[]).find((f) => f.name === name)
    if (!field || field.formula) throw new Error('Campo não editável')
    // Atualiza só a chave, para duas pessoas preenchendo campos diferentes não se sobrescreverem.
    await db.update(sheet).set({ values: sql`${sheet.values} || jsonb_build_object(${name}::text, ${JSON.stringify(value)}::jsonb)` }).where(eq(sheet.id, sheetId))
    // Inclui quem mandou: a mesma tela pode ter a ficha e o editor de campos abertos em janelas diferentes.
    io.to(`sheet:${sheetId}`).emit('sheet:changed', { sheetId, name, value })
    if (row.sheet.actorId) for (const fn of listeners) fn(io, campaignId, row.sheet.actorId)
  }))

  s.on('sheet:note', handler(Note.parse, async ({ sheetId, data }) => {
    const row = await loadSheet(campaignId, sheetId)
    if (!row || !canView(s, row.ownerIds)) throw new Error('Ficha não encontrada')
    await db.insert(sheetNote).values({ sheetId, userId: s.data.member.userId, data }).onConflictDoUpdate({ target: [sheetNote.sheetId, sheetNote.userId], set: { data } })
  }))

  s.on('template:join', handler(z.object({ templateId: z.string() }).parse, async ({ templateId }) => {
    const member = await refreshMember(s)
    if (!member || !can(member, 'template.edit', null)) throw new Error('Só o mestre edita o molde')
    const [t] = await db.select().from(sheetTemplate).where(and(eq(sheetTemplate.id, templateId), eq(sheetTemplate.campaignId, campaignId)))
    if (!t) throw new Error('Molde não encontrado')
    s.join(`tpl:${templateId}`)
    return t
  }))

  s.on('template:save', handler(Save.parse, async ({ templateId, fields, name }) => {
    const member = await refreshMember(s)
    if (!member || !can(member, 'template.edit', null)) throw new Error('Só o mestre edita o molde')
    const names = new Set(fields.map((f) => f.name))
    await db.transaction(async (tx) => {
      const [t] = await tx.update(sheetTemplate).set({ fields, ...(name ? { name } : {}) }).where(and(eq(sheetTemplate.id, templateId), eq(sheetTemplate.campaignId, campaignId))).returning({ id: sheetTemplate.id })
      if (!t) throw new Error('Molde não encontrado')
      // Mudar o molde atualiza todas as fichas dele; valores de campos removidos ficam guardados 30 dias.
      for (const sh of await tx.select({ id: sheet.id, values: sheet.values }).from(sheet).where(eq(sheet.templateId, templateId)).for('update')) {
        await tx.update(sheet).set({ values: reconcileValues(sh.values as Record<string, unknown>, names) }).where(eq(sheet.id, sh.id))
      }
    })
    io.to(`tpl:${templateId}`).emit('template:changed', { templateId, fields })
  }))
}
