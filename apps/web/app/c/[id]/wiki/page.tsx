import { getTranslations } from 'next-intl/server'
export default async function WikiHome() {
  const t = await getTranslations('wiki')
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-muted">
      <p>{t.rich('pick', { key: (chunks) => <kbd className="rounded border border-line px-1">{chunks}</kbd> })}</p>
    </div>
  )
}
