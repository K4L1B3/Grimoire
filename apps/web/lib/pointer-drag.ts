// Arraste por ponteiro, não o nativo: no Chrome com X11 o nativo captura o mouse do sistema e ele pode ficar preso. Esc cancela.
export function pointerDrag<S>(e: React.PointerEvent<HTMLElement>, label: string, spotAt: (x: number, y: number) => S | null, onOver: (s: S | null) => void, onDrop: (s: S, at: PointerEvent) => void) {
  if (e.button !== 0 || (e.target as HTMLElement).closest('input')) return
  const el = e.currentTarget, id = e.pointerId, x0 = e.clientX, y0 = e.clientY
  let ghost: HTMLElement | null = null
  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
      // Capturar aqui, e não no clique, faz o botão do item só deixar de abrir quando houve arraste de verdade.
      el.setPointerCapture(id)
      ghost = document.body.appendChild(Object.assign(document.createElement('div'), { textContent: label, className: 'pointer-events-none fixed top-0 left-0 z-50 max-w-48 truncate rounded-lg border border-accent bg-panel px-2 py-1 text-xs text-ink shadow-xl' }))
    }
    ghost.style.translate = `${ev.clientX + 12}px ${ev.clientY + 12}px`
    onOver(spotAt(ev.clientX, ev.clientY))
  }
  const end = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('keydown', key)
    ghost?.remove()
    onOver(null)
  }
  const up = (ev: PointerEvent) => {
    const spot = ghost && spotAt(ev.clientX, ev.clientY)
    end()
    if (spot) onDrop(spot, ev)
  }
  const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') end() }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', end)
  window.addEventListener('keydown', key)
}
