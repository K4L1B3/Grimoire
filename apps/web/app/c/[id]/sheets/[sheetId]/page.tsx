import { SheetView } from '@/components/sheet-view'

export default async function SheetPage({ params }: { params: Promise<{ sheetId: string }> }) {
  return <SheetView sheetId={(await params).sheetId} />
}
