'use server'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, user as userTable } from '@grimorio/db'
import { requireUser } from '@/lib/session'
import { deleteAvatar, systemAvatars } from '@/lib/avatars'

const name = z.string().trim().min(1, 'Dê um nome').max(80)

// Só avatar do sistema passa por aqui; foto enviada vai por /api/avatar.
export async function updateProfile(patch: { name?: string; image?: string }) {
  const user = await requireUser()
  if (patch.image !== undefined && !(await systemAvatars()).includes(patch.image)) throw new Error('Avatar inválido')
  await db.update(userTable).set({ name: patch.name === undefined ? undefined : name.parse(patch.name), image: patch.image }).where(eq(userTable.id, user.id))
  if (patch.image !== undefined) await deleteAvatar(user.image)
  revalidatePath('/', 'layout')
}
