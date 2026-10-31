'use client'
import { useCallback, useEffect, useRef } from 'react'
import type { MessageView } from '@grimorio/core'
import { useSocketEvent } from './realtime'

const SIDES = new Set([4, 6, 8, 10, 12, 20, 100])
type Box = { initialize(): Promise<void>; roll(n: string): Promise<unknown>; clearDice(): void; updateConfig(c: object): Promise<void> }

// Dado 3D (D7): a física anima até o resultado que o servidor já sorteou, então o dado mostra sempre o total do chat.
export function Dice3D({ enabled }: { enabled: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const box = useRef<Promise<Box> | null>(null)
  const queue = useRef(Promise.resolve())
  const clear = useRef<ReturnType<typeof setTimeout>>(undefined)

  const getBox = () => (box.current ??= import('@3d-dice/dice-box-threejs').then(async ({ default: DiceBox }) => {
    const b = new DiceBox('#dice-3d', { sounds: false, shadows: false, theme_surface: 'green-felt', theme_material: 'plastic', gravity_multiplier: 400, baseScale: 90, strength: 1.2, assetPath: '/' }) as unknown as Box
    await b.initialize()
    return b
  }))

  useEffect(() => () => clearTimeout(clear.current), [])

  useSocketEvent<MessageView>('chat:new', useCallback((m) => {
    if (!enabled || !('roll' in m) || !m.roll || m.quiet) return
    // Só dados com poliedro (d4–d20, d100); explosões entram como dados extras na ordem certa.
    const parts = m.roll.terms.flatMap((t) => (t.kind === 'dice' && SIDES.has(t.sides) ? [`${t.dice.length}d${t.sides}@${t.dice.map((d) => d.value).join(',')}`] : []))
    if (!parts.length) return
    const values = parts.map((p) => p.split('@')[1]).join(',')
    const notation = `${parts.map((p) => p.split('@')[0]).join('+')}@${values}`
    const color = m.color ?? '#c9a24a'
    queue.current = queue.current.then(async () => {
      const b = await getBox()
      clearTimeout(clear.current)
      await b.updateConfig({ theme_customColorset: { name: `g${color}`, background: color, foreground: contrast(color), outline: '#00000066', texture: 'none', material: 'plastic' } })
      await b.roll(notation)
      clear.current = setTimeout(() => b.clearDice(), 2500)
    }).catch(() => {})
  }, [enabled]))

  if (!enabled) return null
  return <div id="dice-3d" ref={host} aria-hidden className="pointer-events-none fixed inset-0 z-30 [&>canvas]:size-full" />
}

function contrast(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 140 ? '#111111' : '#ffffff'
}
