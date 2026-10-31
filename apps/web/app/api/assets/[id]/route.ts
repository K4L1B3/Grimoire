import { eq } from 'drizzle-orm'
import { db, asset } from '@grimorio/db'
import { requireMember, requireUser } from '@/lib/session'
import { getFile, readRange } from '@/lib/storage'

// Cerca de 2 min de música. Respostas curtas não prendem conexão com o MinIO enquanto o navegador espera para pedir o resto.
const CHUNK = 2 * 1024 * 1024

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [a] = await db.select().from(asset).where(eq(asset.id, id))
  if (!a) return new Response('Não encontrado', { status: 404 })
  // Som padrão não é de nenhuma campanha: qualquer conta pode ouvir.
  await (a.campaignId ? requireMember(a.campaignId) : requireUser())
  // Asset é imutável (id novo a cada upload), então o navegador pode guardar para sempre.
  const headers = { 'content-type': a.mime, 'cache-control': 'private, max-age=31536000, immutable' }
  if (a.kind === 'audio') {
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get('range') ?? '')
    const start = range ? Number(range[1]) : 0
    if (start >= a.size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${a.size}` } })
    const end = Math.min(a.size - 1, range ? start + CHUNK - 1 : Infinity, range?.[2] ? Number(range[2]) : Infinity)
    return new Response(await readRange(a.storageKey, start, end), {
      status: range ? 206 : 200,
      headers: { ...headers, 'accept-ranges': 'bytes', 'content-length': String(end - start + 1), ...(range && { 'content-range': `bytes ${start}-${end}/${a.size}` }) },
    })
  }
  return new Response(await getFile(a.storageKey) as BodyInit, { headers })
}
