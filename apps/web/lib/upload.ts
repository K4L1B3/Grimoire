import type { SoundGroup } from '@grimorio/core'

export type Uploaded = { id: string; url: string; width: number | null; height: number | null; name: string }

export async function upload(campaignId: string, file: File, kind: 'image' | 'pdf' | 'map'): Promise<Uploaded> {
  const body = new FormData()
  body.set('campaignId', campaignId)
  body.set('kind', kind)
  body.set('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Falha no envio')
  return json
}

export async function uploadAvatar(file: File) {
  const body = new FormData()
  body.set('file', file)
  const res = await fetch('/api/avatar', { method: 'POST', body })
  if (!res.ok) throw new Error((await res.json()).error ?? 'Falha no envio')
}

export type UploadProgress = { phase: 'sending' | 'processing'; fraction: number; left: number | null }

// Estima o tempo restante pelo ritmo médio da etapa e só avisa quando o número inteiro muda.
function tracker(phase: UploadProgress['phase'], report: (p: UploadProgress) => void) {
  const started = performance.now()
  let shown = -1
  return (fraction: number) => {
    const percent = Math.floor(fraction * 100)
    if (percent === shown) return
    shown = percent
    const elapsed = (performance.now() - started) / 1000
    report({ phase, fraction, left: fraction > 0.02 ? (elapsed * (1 - fraction)) / fraction : null })
  }
}

// XHR, e não fetch: é o único jeito de o navegador contar os bytes enviados. A resposta chega linha a linha com o avanço da conversão.
export function uploadAudio(campaignId: string, file: File, group: SoundGroup, report: (p: UploadProgress) => void) {
  const params = new URLSearchParams({ campaignId, group, name: file.name.replace(/\.[^.]+$/, '') })
  return new Promise<{ id: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const sending = tracker('sending', report), processing = tracker('processing', report)
    let read = 0
    let result: { id?: string; error?: string } = {}
    const readLines = () => {
      const end = xhr.responseText.lastIndexOf('\n') + 1
      for (const line of xhr.responseText.slice(read, end).split('\n').filter(Boolean)) {
        const message = JSON.parse(line)
        if ('progress' in message) processing(message.progress)
        else result = message
      }
      read = end
    }
    xhr.upload.onprogress = (e) => sending(e.loaded / e.total)
    xhr.upload.onload = () => processing(0)
    xhr.onprogress = readLines
    xhr.onerror = () => reject(new Error('Falha no envio'))
    xhr.onload = () => {
      if (xhr.status === 200) readLines()
      else try { result = JSON.parse(xhr.responseText) } catch {}
      if (result.id) resolve({ id: result.id })
      else reject(new Error(result.error ?? 'Falha no envio'))
    }
    xhr.open('POST', `/api/upload/audio?${params}`)
    xhr.send(file)
  })
}
