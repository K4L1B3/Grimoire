'use client'
// Janelas flutuantes por cima da mesa (estilo Roll20): ficha, notas, anexos, editor de campos.
// Ficam abertas até a pessoa fechar, sobrevivem à navegação e lembram posição e tamanho por campanha.
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Maximize2, Minimize2, Minus, PanelLeft, PanelRight, Square, X } from 'lucide-react'
import { clampPane, DEFAULT_PANE, type Side } from '@grimorio/core'

export type WinKind = 'sheet' | 'sheets' | 'page' | 'attachment' | 'editor' | 'combat' | 'sound'
export type Win = { kind: WinKind; ref: string; title: string; x: number; y: number; w: number; h: number; z: number; min?: boolean; max?: boolean; dock?: Side; dockSize?: number; extra?: Record<string, string> }
type OpenArgs = { kind: WinKind; ref: string; title: string; w?: number; h?: number; x?: number; y?: number; extra?: Record<string, string> }
type Ctx = { wins: Win[]; open: (a: OpenArgs) => void; close: (key: string) => void; focus: (key: string) => void; patch: (key: string, p: Partial<Win>) => void; dock: (key: string, side: Side) => void; isOpen: (kind: WinKind, ref: string) => boolean }

const WindowsContext = createContext<Ctx | null>(null)
export const winKey = (w: Pick<Win, 'kind' | 'ref'>) => `${w.kind}:${w.ref}`

// Herda o tamanho do painel que vai substituir ou, sem ele, o último que a própria janela usou.
const paneSize = (ws: Win[], w: Win, side: Side) => {
  const rest = ws.filter((x) => x !== w)
  return clampPane(rest.find((x) => x.dock === side)?.dockSize ?? w.dockSize ?? DEFAULT_PANE, rest.find((x) => x.dock && x.dock !== side)?.dockSize ?? 0)
}

export function WindowsProvider({ campaignId, children }: { campaignId: string; children: React.ReactNode }) {
  const storage = `grimorio:janelas:${campaignId}`
  const [wins, setWins] = useState<Win[]>([])
  // Só salva depois de carregar: senão o primeiro render (lista vazia) apagaria as janelas guardadas.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    // Áudio já não abre em janela: a prévia toca dentro da mesa de som, e uma janela salva antes disso voltaria vazia.
    try { setWins((JSON.parse(localStorage.getItem(storage) ?? '[]') as Win[]).filter((w) => !w.extra?.mime?.startsWith('audio/'))) } catch {}
    setReady(true)
  }, [storage])
  useEffect(() => { if (ready) try { localStorage.setItem(storage, JSON.stringify(wins)) } catch {} }, [wins, storage, ready])

  // Janelas ficam acima da mesa, da biblioteca e do dado 3D; a bandeja de minimizadas, acima de tudo.
  const top = (ws: Win[]) => Math.max(50, ...ws.map((w) => w.z)) + 1
  // Abrir a mesma coisa duas vezes só traz a janela que já existe para a frente.
  const open = useCallback((a: OpenArgs) => setWins((ws) => {
    const key = winKey(a)
    const cur = ws.find((w) => winKey(w) === key)
    if (cur) return ws.map((w) => (w === cur ? { ...w, min: false, z: top(ws) } : w))
    const n = ws.length
    const w = Math.min(a.w ?? 640, window.innerWidth - 100), h = Math.min(a.h ?? 860, window.innerHeight - 56)
    return [...ws, { kind: a.kind, ref: a.ref, title: a.title, extra: a.extra, w, h, x: a.x ?? Math.max(84, window.innerWidth - w - 360 - n * 28), y: a.y ?? 40 + n * 12, z: top(ws) }]
  }), [])
  const close = useCallback((key: string) => setWins((ws) => ws.filter((w) => winKey(w) !== key)), [])
  const focus = useCallback((key: string) => setWins((ws) => (ws.find((w) => winKey(w) === key)?.z === top(ws) - 1 ? ws : ws.map((w) => (winKey(w) === key ? { ...w, z: top(ws) } : w)))), [])
  const patch = useCallback((key: string, p: Partial<Win>) => setWins((ws) => ws.map((w) => (winKey(w) === key ? { ...w, ...p } : w))), [])
  // Um painel por lado: quem já estava ali volta a flutuar onde estava antes.
  const dock = useCallback((key: string, side: Side) => setWins((ws) => {
    const me = ws.find((w) => winKey(w) === key)
    if (!me) return ws
    const dockSize = paneSize(ws, me, side)
    return ws.map((w) => (w === me ? { ...w, dock: side, dockSize, min: false, max: false } : w.dock === side ? { ...w, dock: undefined } : w))
  }), [])
  const isOpen = useCallback((kind: WinKind, ref: string) => wins.some((w) => w.kind === kind && w.ref === ref), [wins])

  return <WindowsContext.Provider value={{ wins, open, close, focus, patch, dock, isOpen }}>{children}</WindowsContext.Provider>
}

export function useWindows() {
  const c = useContext(WindowsContext)
  if (!c) throw new Error('useWindows fora de <WindowsProvider>')
  return c
}

// A área entre a barra lateral e o chat: painéis encaixados ocupam os lados e a página encolhe entre eles.
// As janelas moram sempre aqui, encaixadas ou não: mudar de modo não remonta o conteúdo (PDF, ficha em edição).
export function SplitStage({ windows, children }: { windows: React.ReactNode; children: React.ReactNode }) {
  const { wins } = useWindows()
  const inset = (side: Side) => `${(wins.find((w) => w.dock === side && !w.min)?.dockSize ?? 0) * 100}%`
  return (
    <div data-stage className="relative min-w-0 flex-1">
      <main className="absolute inset-y-0 overflow-auto" style={{ left: inset('left'), right: inset('right') }}>{children}</main>
      {windows}
    </div>
  )
}

const SIDES = [['left', 'Dividir à esquerda', PanelLeft], ['right', 'Dividir à direita', PanelRight]] as const
// Faixa nas bordas da mesa que aceita a janela; estreita para mover uma janela não encaixá-la sem querer.
const SNAP_ZONE = 112

// Enquanto a janela é arrastada: as duas bordas ficam marcadas e a que está sob o ponteiro se abre na forma do painel.
function SnapZones({ side, z, size }: { side?: Side; z: number; size: (s: Side) => number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: z }}>
      {SIDES.map(([s, label, Icon]) => (
        <div key={s} style={{ [s]: 0, width: side === s ? `${size(s) * 100}%` : SNAP_ZONE }}
          className={`absolute inset-y-0 flex items-center justify-center overflow-hidden border-2 border-dashed transition-[width,background-color,border-color] duration-150 ease-(--ease-out-soft) ${side === s ? 'border-accent bg-accent/20' : 'border-accent/40 bg-accent/5'}`}>
          <span className={`flex flex-col items-center gap-1 text-center text-xs font-medium ${side === s ? 'text-accent' : 'text-muted'}`}><Icon size={20} aria-hidden /> {label}</span>
        </div>
      ))}
    </div>
  )
}

// Desenha todas as janelas; `render` devolve o conteúdo de cada tipo.
export function WindowLayer({ render }: { render: (w: Win) => React.ReactNode }) {
  const { wins, close, focus, patch, dock } = useWindows()
  const [snap, setSnap] = useState<{ key: string; side?: Side } | null>(null)
  const dragged = snap && wins.find((w) => winKey(w) === snap.key)
  const minimized = wins.filter((w) => w.min)
  return (
    <>
      {/* Antes das janelas e com o z da arrastada: fica sobre as demais e sob ela. */}
      {dragged && <SnapZones side={snap.side} z={dragged.z} size={(s) => paneSize(wins, dragged, s)} />}
      {wins.filter((w) => !w.min).map((w) => (
        <FloatingWindow key={winKey(w)} win={w} otherPane={wins.find((x) => x.dock && x !== w)?.dockSize ?? 0} onClose={() => close(winKey(w))} onFocus={() => focus(winKey(w))} onPatch={(p) => patch(winKey(w), p)}
          onDock={(s) => dock(winKey(w), s)} onSnap={(side) => setSnap({ key: winKey(w), side })} onDrop={(s) => { setSnap(null); if (s) dock(winKey(w), s) }}>
          {render(w)}
        </FloatingWindow>
      ))}
      {minimized.length > 0 && (
        <div className="fixed bottom-3 left-20 z-[900] flex max-w-[40vw] flex-wrap gap-1">
          {minimized.map((w) => (
            <button key={winKey(w)} className="btn animate-pop max-w-48 bg-raised py-1 text-xs" onClick={() => patch(winKey(w), { min: false, z: Math.max(...wins.map((x) => x.z)) + 1 })} title={w.title}>
              <Square size={12} aria-hidden /> <span className="truncate">{w.title}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

const MIN_W = 300, MIN_H = 200
// Alças das 4 bordas e dos 4 cantos; a do canto inferior direito é a visível.
const EDGES: [string, string][] = [
  ['n', 'top-0 inset-x-3 h-1.5 cursor-ns-resize'], ['s', 'bottom-0 inset-x-3 h-1.5 cursor-ns-resize'],
  ['w', 'left-0 inset-y-3 w-1.5 cursor-ew-resize'], ['e', 'right-0 inset-y-3 w-1.5 cursor-ew-resize'],
  ['nw', 'top-0 left-0 size-3 cursor-nwse-resize'], ['ne', 'top-0 right-0 size-3 cursor-nesw-resize'], ['sw', 'bottom-0 left-0 size-3 cursor-nesw-resize'],
  ['se', 'right-0 bottom-0 size-5 cursor-nwse-resize bg-[linear-gradient(135deg,transparent_50%,var(--color-accent)_50%)] opacity-60 transition-opacity hover:opacity-100'],
]

function FloatingWindow({ win, otherPane, children, onClose, onFocus, onPatch, onDock, onSnap, onDrop }: { win: Win; otherPane: number; children: React.ReactNode; onClose: () => void; onFocus: () => void; onPatch: (p: Partial<Win>) => void; onDock: (side: Side) => void; onSnap: (side?: Side) => void; onDrop: (side?: Side) => void }) {
  const drag = (e: React.PointerEvent<HTMLElement>, mode: string) => {
    if (e.button !== 0 || win.max || (e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    // Captura o ponteiro: o arraste continua mesmo passando por cima de um PDF em iframe.
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const stage = el.closest('[data-stage]')!.getBoundingClientRect()
    const sx = e.clientX, sy = e.clientY, { w, h } = win
    // Puxada de um painel, a janela volta ao tamanho flutuante com o título sob o ponteiro.
    const x = win.dock ? sx - w / 2 : win.x, y = win.dock ? sy - 14 : win.y
    let side: Side | undefined
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      if (mode === 'split') return onPatch({ dockSize: clampPane((win.dock === 'left' ? ev.clientX - stage.left : stage.right - ev.clientX) / stage.width, otherPane) })
      if (mode === 'move') {
        if (win.dock && Math.hypot(dx, dy) < 8) return
        side = ev.clientX < stage.left + SNAP_ZONE ? 'left' : ev.clientX > stage.right - SNAP_ZONE ? 'right' : undefined
        onSnap(side)
        return onPatch({ dock: undefined, x: Math.min(window.innerWidth - 80, Math.max(-w + 120, x + dx)), y: Math.min(window.innerHeight - 40, Math.max(0, y + dy)) })
      }
      const p: Partial<Win> = {}
      if (mode.includes('e')) p.w = Math.max(MIN_W, w + dx)
      if (mode.includes('s')) p.h = Math.max(MIN_H, h + dy)
      if (mode.includes('w')) (p.w = Math.max(MIN_W, w - dx)), (p.x = x + w - p.w)
      if (mode.includes('n')) (p.h = Math.max(MIN_H, h - dy)), (p.y = y + h - p.h)
      onPatch(p)
    }
    el.addEventListener('pointermove', move)
    // lostpointercapture vale também para arraste cancelado: as zonas não ficam presas na tela.
    el.addEventListener('lostpointercapture', () => { el.removeEventListener('pointermove', move); if (mode === 'move') onDrop(side) }, { once: true })
  }
  const toggleMax = () => onPatch({ max: !win.max })
  // Encaixada segue o palco, abaixo das flutuantes para nenhuma se perder atrás do painel; maximizada ocupa tudo menos a barra lateral.
  const rect = win.dock ? { [win.dock]: 0, top: 0, height: '100%', width: `${(win.dockSize ?? DEFAULT_PANE) * 100}%` }
    : win.max ? { left: 72, top: 0, width: 'calc(100vw - 72px)', height: '100dvh' } : { left: win.x, top: win.y, width: win.w, height: win.h }
  return (
    <section role="dialog" aria-label={win.title} onPointerDownCapture={onFocus}
      className={`animate-pop flex flex-col overflow-hidden border border-line bg-panel ${win.dock ? 'absolute' : 'fixed shadow-xl shadow-black/30'} ${win.max || win.dock ? '' : 'rounded-xl'}`}
      style={{ ...rect, zIndex: win.dock ? 50 : win.z }}>
      <header onPointerDown={(e) => drag(e, 'move')} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) { if (win.dock) onPatch({ dock: undefined }); else toggleMax() } }}
        className={`flex shrink-0 items-center gap-2 border-b border-line bg-raised px-3 py-1.5 select-none ${win.max ? '' : 'cursor-grab active:cursor-grabbing'}`}>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{win.title}</h2>
        {SIDES.map(([side, label, Icon]) => (
          <button key={side} className={`rounded p-1 transition-colors hover:bg-panel hover:text-ink ${win.dock === side ? 'text-accent' : 'text-muted'}`} aria-label={label} title={label} aria-pressed={win.dock === side}
            onClick={() => (win.dock === side ? onPatch({ dock: undefined }) : onDock(side))}><Icon size={14} /></button>
        ))}
        <button className="rounded p-1 text-muted transition-colors hover:bg-panel hover:text-ink" aria-label="Minimizar" title="Minimizar" onClick={() => onPatch({ min: true })}><Minus size={14} /></button>
        {!win.dock && <button className="rounded p-1 text-muted transition-colors hover:bg-panel hover:text-ink" aria-label={win.max ? 'Restaurar' : 'Maximizar'} title={win.max ? 'Restaurar' : 'Maximizar'} onClick={toggleMax}>{win.max ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>}
        <button className="rounded p-1 text-muted transition-colors hover:bg-fumble/20 hover:text-fumble" aria-label="Fechar janela" title="Fechar" onClick={onClose}><X size={14} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      {win.dock
        ? <span data-resize="split" onPointerDown={(e) => drag(e, 'split')} aria-hidden className={`absolute inset-y-0 z-20 w-1.5 cursor-ew-resize touch-none transition-colors hover:bg-accent ${win.dock === 'left' ? 'right-0' : 'left-0'}`} />
        : !win.max && EDGES.map(([mode, cls]) => <span key={mode} data-resize={mode} onPointerDown={(e) => drag(e, mode)} aria-hidden className={`absolute z-20 touch-none ${cls}`} />)}
    </section>
  )
}
