'use client'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Music } from 'lucide-react'
import { musicPosition, type SoundLayer, type SoundState } from '@grimorio/core'
import { request, useRealtime, useSocketEvent } from './realtime'

const CROSSFADE = 3
const STORAGE = 'grimorio:music:volume'
const url = (id: string) => `/api/assets/${id}`

type Deck = { id: string; el: HTMLAudioElement; gain: GainNode }

// O áudio é decodificado em streaming pelo navegador (<audio>) e os fades rodam na thread de áudio (GainNode):
// sem timer por quadro, nada disso pesa na mesa. O AudioContext só nasce quando há som.
class Engine {
  ctx = new AudioContext()
  master = this.ctx.createGain()
  layers = new Map<string, Layer>()
  effects = new Map<string, Promise<AudioBuffer>>()

  constructor(level: number, onBlocked: (blocked: boolean) => void) {
    this.master.gain.value = level
    this.master.connect(this.ctx.destination)
    const report = () => onBlocked(this.ctx.state !== 'running')
    this.ctx.onstatechange = report
    report()
  }

  // Curva exponencial: entrar e sair ao mesmo tempo não cria buraco no volume, e interromper um fade no meio não dá estalo.
  fade(gain: GainNode, to: number, seconds = CROSSFADE) {
    const now = this.ctx.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setTargetAtTime(to, now, seconds / 3)
  }

  set({ layers }: SoundState) {
    const wanted = new Map(layers.map((l) => [l.key, l]))
    for (const [key, layer] of this.layers) {
      if (wanted.has(key)) continue
      layer.stop()
      this.layers.delete(key)
    }
    for (const [key, spec] of wanted) {
      const layer = this.layers.get(key)
      if (layer) layer.update(spec)
      else this.layers.set(key, new Layer(this, spec))
    }
  }

  // Efeito vai para a memória: sai na hora, repete sem esperar e pode se sobrepor a si mesmo.
  async play(id: string, gain: number) {
    // Com o som bloqueado ele sairia atrasado, junto com tudo o que foi disparado antes do primeiro clique.
    if (this.ctx.state !== 'running') return
    let buffer = this.effects.get(id)
    if (!buffer) {
      buffer = fetch(url(id)).then((r) => r.arrayBuffer()).then((data) => this.ctx.decodeAudioData(data))
      this.effects.set(id, buffer)
      buffer.catch(() => this.effects.delete(id))
    }
    const source = this.ctx.createBufferSource()
    const volume = this.ctx.createGain()
    source.buffer = await buffer
    volume.gain.value = gain
    source.connect(volume).connect(this.master)
    source.start()
  }

  unlock() {
    this.ctx.resume().then(() => { for (const layer of this.layers.values()) layer.resume() }, () => {})
  }

  close() {
    for (const layer of this.layers.values()) layer.close()
    this.ctx.close()
  }
}

// Uma camada toca sua lista em ciclo e emenda cada fim no começo seguinte com crossfade, que também esconde a costura do loop.
class Layer {
  deck: Deck | null = null
  index = 0
  engine: Engine
  spec: SoundLayer

  constructor(engine: Engine, spec: SoundLayer) {
    this.engine = engine
    this.spec = spec
    const pos = musicPosition(spec.tracks, spec.elapsed)
    this.index = pos?.index ?? 0
    this.start(pos?.offset ?? 0)
  }

  start(offset: number) {
    const { ctx, master } = this.engine
    const track = this.spec.tracks[this.index % this.spec.tracks.length]!
    const el = new Audio(url(track.id))
    const gain = ctx.createGain()
    gain.gain.value = 0
    ctx.createMediaElementSource(el).connect(gain).connect(master)
    const overlap = Math.min(CROSSFADE, track.duration / 3)
    el.ontimeupdate = () => {
      if (track.duration - el.currentTime > overlap) return
      el.ontimeupdate = null
      this.index = (this.index % this.spec.tracks.length) + 1
      this.start(0)
    }
    el.currentTime = offset
    this.release(overlap)
    this.deck = { id: track.id, el, gain }
    // Sem gesto do usuário o navegador recusa; quem libera é o primeiro clique (unlock).
    el.play().catch(() => {})
    this.engine.fade(gain, this.spec.gain, overlap)
  }

  // Volume muda na hora; lista nova vale a partir da próxima emenda, a não ser que a faixa atual tenha saído dela.
  update(spec: SoundLayer) {
    this.spec = spec
    if (!spec.tracks.some((t) => t.id === this.deck?.id)) {
      this.index = 0
      this.start(0)
    } else if (this.deck) this.engine.fade(this.deck.gain, spec.gain, 1)
  }

  resume() {
    this.deck?.el.play().catch(() => {})
  }

  release(seconds: number) {
    const d = this.deck
    if (!d) return
    this.deck = null
    d.el.ontimeupdate = null
    this.engine.fade(d.gain, 0, seconds)
    setTimeout(() => drop(d), seconds * 1500)
  }

  stop() {
    this.release(CROSSFADE)
  }

  close() {
    if (this.deck) drop(this.deck)
  }
}

// Tirar o src cancela o download e libera o decodificador.
function drop({ el, gain }: Deck) {
  el.pause()
  el.removeAttribute('src')
  el.load()
  gain.disconnect()
}

// Fica na barra lateral: sobrevive à navegação, então o som segue na wiki. Quem manda é o mestre; aqui é só o volume de cada um.
export function MusicPlayer() {
  const { socket, connected } = useRealtime()
  const t = useTranslations('music')
  const [state, setState] = useState<SoundState | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [level, setLevel] = useState(1)
  const levelRef = useRef(level)
  levelRef.current = level
  const engine = useRef<Engine | null>(null)
  const ensure = () => (engine.current ??= new Engine(levelRef.current, setBlocked))

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE)
      if (saved !== null) setLevel(Number(saved))
    } catch {}
  }, [])
  useSocketEvent<SoundState>('music:state', setState)
  useSocketEvent<{ id: string; gain: number }>('music:fx', useCallback(({ id, gain }) => void ensure().play(id, gain).catch(() => {}), []))
  useEffect(() => {
    if (connected) request<SoundState>(socket, 'music:get').then(setState).catch(() => {})
  }, [connected, socket])

  useEffect(() => {
    if (state?.layers.length) ensure().set(state)
    else if (state) engine.current?.set(state)
  }, [state])
  useEffect(() => { if (engine.current) engine.current.master.gain.value = level }, [level])
  useEffect(() => () => { engine.current?.close(); engine.current = null }, [])

  useEffect(() => {
    if (!blocked) return
    const unlock = () => engine.current?.unlock()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [blocked])

  if (!state?.layers.length && !blocked) return null
  const changeLevel = (value: number) => {
    setLevel(value)
    try { localStorage.setItem(STORAGE, String(value)) } catch {}
  }
  return (
    <div className="flex w-14 flex-col items-center gap-1 py-2 text-[10px] font-medium text-muted">
      {blocked
        ? <button className="flex animate-pulse flex-col items-center gap-0.5 text-center text-accent"><Music size={20} aria-hidden /> {t('unlock')}</button>
        : <span className="flex flex-col items-center gap-0.5 text-accent"><Music size={20} aria-hidden /> {t('listening')}</span>}
      <input type="range" min={0} max={1} step={0.05} value={level} aria-label={t('yourVolume')} title={t('yourVolume')} className="w-12 accent-(--color-accent)" onChange={(e) => changeLevel(Number(e.target.value))} />
    </div>
  )
}
