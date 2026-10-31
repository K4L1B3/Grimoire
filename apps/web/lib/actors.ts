import 'server-only'
import { and, arrayContains, eq } from 'drizzle-orm'
import { db, actor } from '@grimorio/db'
import type { Member } from '@grimorio/core'

// Atores que o membro controla: o mestre controla todos.
export const controlledActors = (campaignId: string, member: Member) =>
  db.select({ id: actor.id, name: actor.name, avatarAssetId: actor.avatarAssetId, ownerIds: actor.ownerIds }).from(actor)
    .where(and(eq(actor.campaignId, campaignId), member.role === 'gm' ? undefined : arrayContains(actor.ownerIds, [member.userId])))
    .orderBy(actor.name)
