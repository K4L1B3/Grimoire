'use server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, macro } from '@grimorio/db'
import { roll, DiceError } from '@grimorio/core'
import { requireMember } from '@/lib/session'

export async function saveMacro(campaignId: string, name: string, formula: string) {
  const { user, member } = await requireMember(campaignId)
  if (member.role === 'observer') throw new Error('Observador não rola dados')
  const f = z.string().trim().min(1).max(200).parse(formula.replace(/^\/(r|roll)\s+/i, ''))
  // Valida a notação já ao salvar; @campo é checado na hora de rolar, com a ficha do personagem.
  try { roll(f.replace(/@[\w.]+/g, '0'), {}, () => 1) } catch (e) { if (e instanceof DiceError) throw new Error(e.message); throw e }
  const [m] = await db.insert(macro).values({ campaignId, userId: user.id, name: z.string().trim().min(1).max(40).parse(name), formula: f }).returning()
  return m!
}

export async function deleteMacro(campaignId: string, id: string) {
  const { user } = await requireMember(campaignId)
  await db.delete(macro).where(and(eq(macro.id, id), eq(macro.userId, user.id), eq(macro.campaignId, campaignId)))
}
