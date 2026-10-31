'use client'
import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'

// Área de soltar arquivo que também abre o seletor ao clicar ou apertar Enter.
export function DropZone({ accept, label, onFile, busy }: { accept: string; label: string; onFile: (f: File) => void; busy?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => input.current?.click()}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files[0]
        if (f) onFile(f)
      }}
      className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-sm text-muted transition-colors ${over ? 'border-accent text-accent' : 'border-line hover:border-accent'}`}
    >
      <Upload aria-hidden />
      {busy ? 'Enviando…' : label}
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </button>
  )
}
