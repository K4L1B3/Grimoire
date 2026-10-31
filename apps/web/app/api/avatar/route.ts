import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, user as userTable } from '@grimorio/db'
import { requireUser } from '@/lib/session'
import { deleteAvatar, saveAvatar } from '@/lib/avatars'

export async function POST(req: Request) {
  const user = await requireUser()
  const file = (await req.formData()).get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Envio inválido' }, { status: 400 })
  try {
    const image = await saveAvatar(file)
    await db.update(userTable).set({ image }).where(eq(userTable.id, user.id))
    await deleteAvatar(user.image)
    return NextResponse.json({ image })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
