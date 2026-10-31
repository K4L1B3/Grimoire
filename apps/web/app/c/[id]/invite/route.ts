import { requireGm } from '@/lib/session'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { campaign } = await requireGm((await params).id)
  return new Response(campaign.inviteCode)
}
