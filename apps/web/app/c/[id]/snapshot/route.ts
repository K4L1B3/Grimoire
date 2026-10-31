import { and, eq } from 'drizzle-orm'
import sharp from 'sharp'
import { db, membership } from '@grimorio/db'
import { requireMember } from '@/lib/session'
import { getFile, putFile } from '@/lib/storage'

// A foto é do que cada membro viu: a do mestre mostra token oculto e área sem névoa, então nunca vale para os outros.
// Chave fixa: a foto nova substitui a anterior em vez de acumular arquivo.
const key = (campaignId: string, userId: string) => `${campaignId}/snapshots/${userId}.webp`
const MAX_BYTES = 1024 * 1024
const WIDTH = 640

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user } = await requireMember(id)
  // A home muda o ?v= a cada foto, então cada endereço é imutável.
  return new Response(await getFile(key(id, user.id)) as BodyInit, { headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000, immutable' } })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user } = await requireMember(id)
  const input = Buffer.from(await req.arrayBuffer())
  if (input.length > MAX_BYTES) return new Response('Foto grande demais', { status: 413 })
  const data = await sharp(input, { limitInputPixels: 4096 * 4096 }).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 70 }).toBuffer().catch(() => null)
  if (!data) return new Response('Foto inválida', { status: 400 })
  await putFile(key(id, user.id), data, 'image/webp')
  await db.update(membership).set({ lastSeenAt: new Date() }).where(and(eq(membership.campaignId, id), eq(membership.userId, user.id)))
  return new Response(null, { status: 204 })
}
