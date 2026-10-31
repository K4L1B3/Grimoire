'use client'
import type { PDFDocumentProxy } from 'pdfjs-dist'

let lib: Promise<typeof import('pdfjs-dist')> | null = null
// pdf.js só no navegador e só quando alguém abre uma ficha; o worker é copiado para /public no dev/build.
export function pdfjs() {
  return (lib ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
    return m
  }))
}

// Devolve a tarefa de carga: quem abriu chama destroy() ao sair da tela.
export async function loadPdf(url: string) {
  const { getDocument } = await pdfjs()
  return getDocument({ url, withCredentials: true })
}

type Box = { x: number; y: number; w: number; h: number }

// Converte um retângulo do PDF (origem embaixo) para fração da página (origem em cima).
async function toFrac(doc: PDFDocumentProxy, index: number) {
  const page = await doc.getPage(index + 1)
  const vp = page.getViewport({ scale: 1 })
  return {
    page,
    rect: ([x1, y1, x2, y2]: number[]): Box => {
      const [ax, ay] = vp.convertToViewportPoint(x1!, y1!) as [number, number]
      const [bx, by] = vp.convertToViewportPoint(x2!, y2!) as [number, number]
      return { x: Math.min(ax, bx) / vp.width, y: Math.min(ay, by) / vp.height, w: Math.abs(bx - ax) / vp.width, h: Math.abs(by - ay) / vp.height }
    },
    vp,
  }
}

// Textos da página em fração, para sugerir o nome do campo (F2).
export async function pageTexts(doc: PDFDocumentProxy, index: number) {
  const { page, vp } = await toFrac(doc, index)
  const content = await page.getTextContent()
  return content.items.flatMap((it) => {
    if (!('str' in it) || !it.str.trim()) return []
    const [, , , , e, f] = it.transform as number[]
    const [x, yBase] = vp.convertToViewportPoint(e!, f!) as [number, number]
    const h = (it.height || 10) * vp.scale
    return [{ str: it.str.trim(), x: x / vp.width, y: (yBase - h) / vp.height, w: (it.width * vp.scale) / vp.width, h: h / vp.height }]
  })
}

// Campos de formulário (AcroForm) já existentes no PDF (F8).
export async function pageWidgets(doc: PDFDocumentProxy, index: number) {
  const { page, rect } = await toFrac(doc, index)
  const anns = await page.getAnnotations()
  return anns.flatMap((a: { subtype?: string; fieldName?: string; fieldType?: string; checkBox?: boolean; multiLine?: boolean; rect: number[] }) => {
    if (a.subtype !== 'Widget' || !a.fieldName) return []
    const type = a.fieldType === 'Btn' ? (a.checkBox ? 'checkbox' : null) : a.fieldType === 'Tx' ? (a.multiLine ? 'textarea' : 'text') : null
    return type ? [{ label: a.fieldName, type: type as 'checkbox' | 'text' | 'textarea', ...rect(a.rect) }] : []
  })
}

// Rótulo mais provável para uma caixa: texto à esquerda na mesma linha, senão logo acima.
export function nearestLabel(texts: (Box & { str: string })[], box: Box) {
  const cy = box.y + box.h / 2
  const left = texts.filter((t) => t.x + t.w <= box.x + 0.01 && Math.abs(t.y + t.h / 2 - cy) < Math.max(box.h, 0.015)).sort((a, b) => b.x + b.w - (a.x + a.w))[0]
  if (left && box.x - (left.x + left.w) < 0.25) return left.str
  const above = texts.filter((t) => t.y + t.h <= box.y + 0.005 && box.y - (t.y + t.h) < 0.05 && t.x < box.x + box.w && t.x + t.w > box.x).sort((a, b) => b.y - a.y)[0]
  return above?.str ?? ''
}
