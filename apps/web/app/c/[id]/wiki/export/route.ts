import { NextResponse } from 'next/server'
import { requireGm } from '@/lib/session'
import { exportCampaign, importCampaign } from '@/lib/wiki-export'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { campaign } = await requireGm((await params).id)
  const zip = await exportCampaign(campaign.id)
  const name = encodeURIComponent(`${campaign.name}-wiki.zip`)
  return new Response(zip as BodyInit, { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename*=UTF-8''${name}` } })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { campaign } = await requireGm((await params).id)
  const file = (await req.formData()).get('file')
  if (!(file instanceof File) || file.size > 500 * 1024 * 1024) return NextResponse.json({ error: 'Envie o .zip exportado' }, { status: 400 })
  try {
    return NextResponse.json(await importCampaign(campaign.id, new Uint8Array(await file.arrayBuffer())))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
