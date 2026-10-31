// "Mostrar aos jogadores": o mestre abre um anexo (carta, mapa do tesouro) numa janela na tela de todos.
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db, asset } from '@grimorio/db'
import { handler, refreshMember, room, type IO, type S } from './ctx.ts'

export function registerHandout(io: IO, s: S) {
  s.on('handout:show', handler(z.object({ assetId: z.string().uuid() }).parse, async ({ assetId }) => {
    const m = await refreshMember(s)
    if (m?.role !== 'gm') throw new Error('Só o mestre mostra anexos')
    const [a] = await db.select({ id: asset.id, name: asset.name, mime: asset.mime }).from(asset).where(and(eq(asset.id, assetId), eq(asset.campaignId, s.data.campaignId)))
    if (!a) throw new Error('Anexo não encontrado')
    s.to(room(s.data.campaignId)).emit('handout', a)
  }))
}
