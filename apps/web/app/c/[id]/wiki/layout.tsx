import { WikiTree } from '@/components/wiki/tree'

export default function WikiLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="w-64 shrink-0 border-r border-line bg-panel/50">
        <WikiTree />
      </aside>
      <div className="relative min-w-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}
