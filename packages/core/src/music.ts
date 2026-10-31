// Mesa de som: cada cena guarda uma mixagem (música por estado + ambientes por nível) e todos ouvem a da cena ativa.
// O servidor só fala quando o mestre muda algo; quem toca e emenda as faixas é cada cliente.
export const MOODS = ['exploration', 'combat', 'victory'] as const
export const ATMOSPHERE_GROUPS = ['ambient', 'action'] as const
export const EFFECT_GROUPS = ['impacts', 'people', 'magic', 'weapons', 'objects', 'monsters'] as const
export const SOUND_GROUPS = [...MOODS, ...ATMOSPHERE_GROUPS, ...EFFECT_GROUPS] as const
export type Mood = (typeof MOODS)[number]
export type SoundGroup = (typeof SOUND_GROUPS)[number]

export type SoundMix = {
  mood: Mood | null
  intensity: number // 0–3
  levels: Record<string, number> // ambiente → nível 1–3
  tracks: Record<Mood, string[]>
  paused: boolean
  startedAt: number // ms; quem entra depois acha a mesma posição da música
}
export const DEFAULT_MIX: SoundMix = { mood: null, intensity: 2, levels: {}, tracks: { exploration: [], combat: [], victory: [] }, paused: false, startedAt: 0 }

const INTENSITY_GAIN = [0.3, 0.5, 0.75, 1]
const LEVEL_GAIN = [0, 0.35, 0.65, 1]

export type SoundTrack = { id: string; duration: number }
// Tempos em segundos. `elapsed` em vez de um horário absoluto: relógio errado no cliente não muda nada.
export type SoundLayer = { key: string; tracks: SoundTrack[]; gain: number; elapsed: number }
export type SoundState = { layers: SoundLayer[] }

export function musicPosition(tracks: SoundTrack[], elapsed: number) {
  const total = tracks.reduce((sum, t) => sum + t.duration, 0)
  if (!total) return null
  let offset = elapsed % total
  for (const [index, t] of tracks.entries()) {
    if (offset < t.duration) return { index, offset }
    offset -= t.duration
  }
  return { index: 0, offset: 0 }
}

// Só id e duração: o nome da faixa pode entregar o que vem pela frente. Som apagado da biblioteca simplesmente some da mixagem.
export function mixLayers(mix: SoundMix, known: Map<string, SoundTrack>, now: number): SoundLayer[] {
  if (mix.paused) return []
  const layers: SoundLayer[] = []
  const tracks = mix.mood ? mix.tracks[mix.mood].flatMap((id) => known.get(id) ?? []) : []
  if (tracks.length) layers.push({ key: `music:${mix.mood}`, tracks, gain: INTENSITY_GAIN[mix.intensity]!, elapsed: (now - mix.startedAt) / 1000 })
  for (const [id, level] of Object.entries(mix.levels)) {
    const track = known.get(id)
    if (track) layers.push({ key: id, tracks: [track], gain: LEVEL_GAIN[level]!, elapsed: 0 })
  }
  return layers
}
