import { requireUser } from '@/lib/session'
import { avatarKey } from '@/lib/avatars'
import { getFile } from '@/lib/storage'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser()
  const { id } = await params
  // O id vira caminho no disco: só aceita o formato de UUID.
  const data = /^[0-9a-f-]{36}$/.test(id) ? await getFile(avatarKey(id)).catch(() => null) : null
  if (!data) return new Response('Não encontrado', { status: 404 })
  return new Response(data as BodyInit, { headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000, immutable' } })
}
