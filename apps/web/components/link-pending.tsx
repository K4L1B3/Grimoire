'use client'
import { useLinkStatus } from 'next/link'
import { Loader2 } from 'lucide-react'

// Fica dentro do <Link>: cobre o cartão enquanto a próxima tela carrega. data-pending mantém o cartão afundado pelo CSS do pai.
export function LinkPending() {
  const { pending } = useLinkStatus()
  return (
    <span aria-hidden data-pending={pending || undefined} className={`pointer-events-none absolute inset-0 grid place-items-center bg-black/45 text-accent transition-opacity duration-150 ${pending ? 'opacity-100' : 'opacity-0'}`}>
      {pending && <Loader2 size={28} className="animate-spin motion-reduce:animate-none" />}
    </span>
  )
}
