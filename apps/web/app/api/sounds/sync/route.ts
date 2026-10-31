import { requireMember } from '@/lib/session'
import { syncDefaultSounds } from '@/lib/storage'

// Rota, e não server action: as actions de um cliente rodam em fila, e a conversão travaria as outras.
export async function POST(req: Request) {
  const { member } = await requireMember(new URL(req.url).searchParams.get('campaignId') ?? '')
  if (member.role !== 'gm') return new Response(null, { status: 403 })
  await syncDefaultSounds()
  return new Response(null, { status: 204 })
}
