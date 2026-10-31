'use client'
import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdf } from '@/lib/pdf'

export function usePdf(url: string) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [aspects, setAspects] = useState<number[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!url) return
    setError('')
    let live = true
    const loaded: { destroy?: () => unknown } = {}
    loadPdf(url).then(async (task) => {
      loaded.destroy = () => task.destroy()
      const d = await task.promise
      const as = await Promise.all(Array.from({ length: d.numPages }, async (_, i) => {
        const vp = (await d.getPage(i + 1)).getViewport({ scale: 1 })
        return vp.height / vp.width
      }))
      if (live) (setDoc(d), setAspects(as))
    }).catch((e) => live && setError(String(e.message ?? e)))
    return () => { live = false; loaded.destroy?.() }
  }, [url])
  return { doc, aspects, error }
}

// Uma página do PDF como fundo; os filhos ficam por cima, posicionados em % (fração da página).
export function PdfPage({ doc, index, aspect, children, overlayRef, ...rest }: { doc: PDFDocumentProxy; index: number; aspect: number; children?: React.ReactNode; overlayRef?: React.Ref<HTMLDivElement> } & React.HTMLAttributes<HTMLDivElement>) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)))
    ro.observe(box.current!)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!width) return
    let task: { cancel(): void; promise: Promise<void> } | null = null
    const t = setTimeout(async () => {
      const page = await doc.getPage(index + 1)
      const dpr = window.devicePixelRatio || 1
      const vp = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * dpr })
      const c = canvas.current!
      c.width = vp.width
      c.height = vp.height
      task = page.render({ canvas: c, viewport: vp })
      task.promise.catch(() => {})
    }, 60)
    return () => { clearTimeout(t); task?.cancel() }
  }, [doc, index, width])

  return (
    <div ref={box} className="relative w-full bg-white shadow-lg" style={{ aspectRatio: `1 / ${aspect}` }}>
      <canvas ref={canvas} className="absolute inset-0 size-full" aria-hidden />
      <div ref={overlayRef} className="absolute inset-0" {...rest}>{children}</div>
    </div>
  )
}
