import { Suspense } from 'react'
import { PageView } from '@/components/wiki/page-view'

export default async function WikiPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params
  return <Suspense><PageView key={pageId} pageId={pageId} /></Suspense>
}
