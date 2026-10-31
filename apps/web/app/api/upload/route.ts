import { NextResponse } from 'next/server'
import { requireMember } from '@/lib/session'
import { saveAsset } from '@/lib/storage'

export async function POST(req: Request) {
  const form = await req.formData()
  const campaignId = String(form.get('campaignId') ?? '')
  const kind = String(form.get('kind') ?? 'image')
  const file = form.get('file')
  if (!(file instanceof File) || !['image', 'pdf', 'map'].includes(kind)) return NextResponse.json({ error: 'Envio inválido' }, { status: 400 })
  const { member } = await requireMember(campaignId)
  // Jogador sobe imagens (retrato, pin); PDF de ficha e mapa são do mestre.
  if (member.role === 'observer' || (kind !== 'image' && member.role !== 'gm')) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  try {
    const a = await saveAsset(campaignId, file, kind as 'image' | 'pdf' | 'map')
    return NextResponse.json({ id: a.id, url: `/api/assets/${a.id}`, width: a.width, height: a.height, name: a.name })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
