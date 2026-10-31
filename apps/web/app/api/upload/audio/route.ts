import { NextResponse } from 'next/server'
import { SOUND_GROUPS, type SoundGroup } from '@grimorio/core'
import { requireMember } from '@/lib/session'
import { processAudio, receiveAudio } from '@/lib/storage'

// Corpo cru em vez de formulário: `req.formData()` carregaria o arquivo inteiro na memória.
// A conversão pode levar minutos, então a resposta é um stream: uma linha JSON por avanço e a última com o resultado.
export async function POST(req: Request) {
  const params = new URL(req.url).searchParams
  const campaignId = params.get('campaignId') ?? ''
  const { member } = await requireMember(campaignId)
  if (member.role !== 'gm') return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  const group = params.get('group') as SoundGroup
  if (!req.body || !SOUND_GROUPS.includes(group)) return NextResponse.json({ error: 'Envio inválido' }, { status: 400 })
  let dir: string
  try {
    dir = await receiveAudio(req.body)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(out) {
      // Quem fechou a aba não recebe mais nada, mas a conversão termina e o som fica salvo.
      const send = (line: object) => { try { out.enqueue(encoder.encode(`${JSON.stringify(line)}\n`)) } catch {} }
      processAudio(dir, { campaignId, name: (params.get('name') ?? '').slice(0, 120), group }, (progress) => send({ progress }))
        .then((a) => send({ id: a.id }), (e) => send({ error: e.message }))
        .finally(() => { try { out.close() } catch {} })
    },
  })
  // no-transform: comprimir acumularia as linhas e a barra andaria aos saltos.
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-transform' } })
}
