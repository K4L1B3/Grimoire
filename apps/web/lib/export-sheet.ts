'use client'
import type { Field } from '@grimorio/core'

// Exportar PDF (F13): desenha os valores nas posições dos campos, por cima do PDF original.
export async function exportSheetPdf(pdfUrl: string, fields: Field[], values: Record<string, unknown>, title: string) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.load(await (await fetch(pdfUrl)).arrayBuffer(), { ignoreEncryption: true })
  const fonts = {
    sans: await pdf.embedFont(StandardFonts.Helvetica),
    serif: await pdf.embedFont(StandardFonts.TimesRoman),
    mono: await pdf.embedFont(StandardFonts.Courier),
    hand: await pdf.embedFont(StandardFonts.HelveticaOblique),
  }
  // Formulários antigos do PDF ficariam por cima dos valores; achata antes de desenhar.
  try { pdf.getForm().flatten() } catch {}
  const pages = pdf.getPages()

  for (const f of fields) {
    const page = pages[f.page]
    if (!page) continue
    const { width: W, height: H } = page.getSize()
    const box = { x: f.x * W, y: H - (f.y + f.h) * H, w: f.w * W, h: f.h * H }
    const font = fonts[f.style?.font ?? 'sans']
    const hex = (f.style?.color ?? '#111111').slice(1)
    const color = rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255)
    const v = values[f.name]

    // Só caracteres que a fonte padrão do PDF consegue desenhar.
    const safe = (s: string) => [...s].filter((ch) => { try { font.encodeText(ch); return true } catch { return false } }).join('')
    const text = (s: string, b: typeof box, size?: number | null) => {
      const t = safe(s)
      if (!t) return
      let sz = size ?? Math.min(b.h * 0.7, 14)
      while (sz > 4 && font.widthOfTextAtSize(t, sz) > b.w - 2) sz -= 0.5
      const tw = font.widthOfTextAtSize(t, sz)
      const align = f.style?.align ?? (f.formula ? 'center' : 'left')
      const x = align === 'center' ? b.x + (b.w - tw) / 2 : align === 'right' ? b.x + b.w - tw - 1 : b.x + 1
      page.drawText(t, { x, y: b.y + (b.h - sz * 0.7) / 2, size: sz, font, color })
    }

    if (f.type === 'checkbox') { if (v) text('X', box, Math.min(box.h, box.w) * 0.9); continue }
    if (f.type === 'image' && typeof v === 'string' && v) {
      const png = await toPng(`/api/assets/${v}`)
      const img = await pdf.embedPng(png)
      const s = Math.min(box.w / img.width, box.h / img.height)
      page.drawImage(img, { x: box.x + (box.w - img.width * s) / 2, y: box.y + (box.h - img.height * s) / 2, width: img.width * s, height: img.height * s })
      continue
    }
    if (f.type === 'list' && Array.isArray(v)) {
      const rowH = (f.rowH ?? 0.022) * H
      v.forEach((row: Record<string, unknown>, i) => {
        let x = box.x
        const y = box.y + box.h - (i + 1) * rowH
        if (y < box.y - 0.5) return
        for (const c of f.columns ?? []) {
          const cell = row[c.name]
          text(c.type === 'checkbox' ? (cell ? 'X' : '') : String(cell ?? ''), { x, y, w: c.w * box.w, h: rowH }, f.style?.size)
          x += c.w * box.w
        }
      })
      continue
    }
    if (v === undefined || v === null || v === '') continue
    const str = typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v)
    if (f.type === 'textarea') {
      const sz = f.style?.size ?? 9
      const lines = wrap(safe(str), (s) => font.widthOfTextAtSize(s, sz), box.w - 2)
      lines.forEach((line, i) => {
        const y = box.y + box.h - (i + 1) * sz * 1.15
        if (y >= box.y) page.drawText(line, { x: box.x + 1, y, size: sz, font, color })
      })
    } else text(str, box, f.style?.size)
  }

  const blob = new Blob([await pdf.save() as BlobPart], { type: 'application/pdf' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${title.replace(/[^\p{L}\p{N} _-]/gu, '')}.pdf` })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function wrap(s: string, width: (s: string) => number, max: number) {
  const out: string[] = []
  for (const para of s.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (width(next) > max && line) (out.push(line), (line = word))
      else line = next
    }
    out.push(line)
  }
  return out
}

// pdf-lib só embute PNG/JPG; o upload guarda WebP, então converte pelo canvas.
async function toPng(url: string) {
  const bmp = await createImageBitmap(await (await fetch(url)).blob())
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  return (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()
}
