'use client'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import type { TableProps } from './table'

// PixiJS precisa do navegador; a mesa não renderiza no servidor.
const Table = dynamic(() => import('./table').then((m) => m.Table), { ssr: false, loading: Opening })

function Opening() {
  return <p className="p-8 text-muted">{useTranslations('table')('opening')}</p>
}

export function PlayClient(props: TableProps) {
  return <Table {...props} />
}
