import { notFound } from 'next/navigation'
import { requireMember } from '@/lib/session'
import { TemplateEditor } from './editor'

export default async function EditTemplate({ params }: { params: Promise<{ id: string; tid: string }> }) {
  const { id, tid } = await params
  const { member } = await requireMember(id)
  if (member.role !== 'gm') notFound()
  return <TemplateEditor campaignId={id} templateId={tid} />
}
