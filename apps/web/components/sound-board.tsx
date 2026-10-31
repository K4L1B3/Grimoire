'use client'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, Bird, Cloud, CloudLightning, CloudRain, Compass, DoorOpen, Droplets, Flame, Hammer, Headphones, Mountain, Music2, Pause, Pencil, Play, Settings, Shield, Skull, Sparkles, Square, Swords, Trash2, Trees, Upload, Users, Volume2, Waves, Wind, X, Zap, type LucideIcon,
} from 'lucide-react'
import { ATMOSPHERE_GROUPS, DEFAULT_MIX, EFFECT_GROUPS, MOODS, type Mood, type SoundGroup, type SoundMix } from '@grimorio/core'
import { deleteAudio, renameItem, soundLibrary } from '@/app/c/[id]/library-actions'
import { uploadAudio, type UploadProgress } from '@/lib/upload'
import { ask, askText } from './confirm'
import { request, useRealtime, useSocketEvent } from './realtime'

type Sound = Awaited<ReturnType<typeof soundLibrary>>[number]
type SceneRow = { id: string; name: string; active: boolean; image: string | null }
type Manage = readonly SoundGroup[]
type Upload = { key: string; name: string; group: SoundGroup; progress: UploadProgress | null; error?: string }

const FX_VOLUME = 'grimorio:music:fx'
const INTENSITIES = [0, 1, 2, 3]
const LEVELS = [{ level: 1, label: 'I' }, { level: 2, label: 'II' }, { level: 3, label: 'III' }]

// Ícone pelo nome do arquivo: som importado já chega com cara de botão, sem o mestre escolher um por um.
const ICONS: [RegExp, LucideIcon][] = [
  [/chuva|rain|tempest|storm/i, CloudRain], [/trov|thunder|rel[aâ]mp|lightning/i, CloudLightning], [/vento|wind/i, Wind],
  [/\brio\b|river|\bmar\b|\bsea\b|ocean|\bonda|wave/i, Waves], [/[aá]gua|water|respingo|splash/i, Droplets], [/fogo|fire|chama|flame|lareira/i, Flame],
  [/flores|forest|floresta|bosque|mata|wood/i, Trees], [/caverna|cave|montanha|mountain/i, Mountain], [/p[aá]ssaro|bird|pato|duck/i, Bird],
  [/multid|crowd|taverna|tavern|pessoas/i, Users], [/porta|door/i, DoorOpen], [/espada|sword|flecha|arrow|lan[cç]a/i, Swords], [/escudo|shield|golpe/i, Shield],
  [/martelo|hammer|machado|axe/i, Hammer], [/magia|magic|feiti|spell/i, Sparkles], [/monstr|drag|\borc|goblin|zumbi|zombie|lobo|wolf|rugido|roar/i, Skull],
]
const GROUP_ICONS: Record<SoundGroup, LucideIcon> = { exploration: Compass, combat: Swords, victory: Music2, ambient: Cloud, action: Users, impacts: Zap, people: Users, magic: Sparkles, weapons: Swords, objects: DoorOpen, monsters: Skull }
const iconOf = (s: Sound) => ICONS.find(([re]) => re.test(s.name))?.[1] ?? GROUP_ICONS[s.group!]

function Badge({ icon: Icon, size = 'size-12' }: { icon: LucideIcon; size?: string }) {
  return <span className={`grid shrink-0 place-items-center bg-accent/20 text-accent ${size}`} style={{ borderRadius: '58% 42% 55% 45% / 48% 56% 44% 52%' }}><Icon size={22} aria-hidden /></span>
}

// Mesa de som do mestre: música por estado, ambientes por nível e efeitos de um toque. Cada cena guarda a própria mixagem.
export function SoundBoard() {
  const { socket, campaignId } = useRealtime()
  const t = useTranslations('music')
  const [scenes, setScenes] = useState<SceneRow[]>([])
  const [sceneId, setSceneId] = useState<string | null>(null)
  const [mix, setMix] = useState<SoundMix>(DEFAULT_MIX)
  const [sounds, setSounds] = useState<Sound[]>([])
  const [tab, setTab] = useState<'atmospheres' | 'effects'>('atmospheres')
  const [manage, setManage] = useState<Manage | null>(null)
  const [fxGain, setFxGain] = useState(1)
  const [error, setError] = useState('')
  const [uploads, setUploads] = useState<Upload[]>([])
  const uploadQueue = useRef<Promise<unknown>>(Promise.resolve())
  const fail = useCallback((e: unknown) => setError((e as Error).message), [])
  const update = (patch: object) => { setError(''); return request(socket, 'music:update', { sceneId, ...patch }).catch(fail) }
  const loadSounds = useCallback(() => soundLibrary(campaignId).then(setSounds).catch(fail), [campaignId, fail])
  // Ao ativar outra cena, a mesa vai junto: é ela que a mesa está ouvindo.
  const loadScenes = useCallback(() => request<SceneRow[]>(socket, 'scene:list').then((rows) => {
    setScenes(rows)
    setSceneId((id) => rows.find((r) => r.active)?.id ?? id ?? rows[0]?.id ?? null)
  }).catch(fail), [socket, fail])

  useEffect(() => { loadScenes(); loadSounds() }, [loadScenes, loadSounds])
  // Traz o que apareceu nas pastas de padrões do MinIO; a lista atualiza quando a conversão termina.
  useEffect(() => { fetch(`/api/sounds/sync?campaignId=${campaignId}`, { method: 'POST' }).then(loadSounds).catch(() => {}) }, [campaignId, loadSounds])
  useEffect(() => { try { setFxGain(Number(localStorage.getItem(FX_VOLUME) ?? 1)) } catch {} }, [])
  useEffect(() => { if (sceneId) request(socket, 'music:scene', { sceneId }).catch(fail) }, [socket, sceneId, fail])
  useSocketEvent('scene:activated', loadScenes)
  useSocketEvent<{ sceneId: string; mix: SoundMix }>('music:view', useCallback((v) => { if (v.sceneId === sceneId) setMix(v.mix) }, [sceneId]))

  const scene = scenes.find((s) => s.id === sceneId)
  if (!scene) return <p className="p-6 text-center text-sm text-muted">{t('noScene')}</p>
  const inGroups = (groups: readonly string[]) => sounds.filter((s) => groups.includes(s.group!))
  const hasSound = mix.mood !== null || Object.keys(mix.levels).length > 0
  // Um arquivo de cada vez: a conversão é pesada. Dá para escolher mais enquanto a fila anda, inclusive em outros grupos.
  const importFiles = (group: SoundGroup, files: File[]) => {
    const items = files.map((file, i): Upload => ({ key: `${Date.now()}-${i}`, name: file.name.replace(/\.[^.]+$/, ''), group, progress: null }))
    setUploads((list) => [...list, ...items])
    items.forEach((item, i) => {
      const change = (patch: Partial<Upload>) => setUploads((list) => list.map((u) => (u.key === item.key ? { ...u, ...patch } : u)))
      uploadQueue.current = uploadQueue.current.then(async () => {
        try {
          const { id } = await uploadAudio(campaignId, files[i]!, group, (progress) => change({ progress }))
          // Música importada aqui já entra na cena aberta.
          if ((MOODS as readonly SoundGroup[]).includes(group)) await update({ track: { id, mood: group, on: true } })
          await loadSounds()
          setUploads((list) => list.filter((u) => u.key !== item.key))
        } catch (e) { change({ error: (e as Error).message }) }
      })
    })
  }
  const dismissUpload = (key: string) => setUploads((list) => list.filter((u) => u.key !== key))

  if (manage) {
    return (
      <SoundManager groups={manage} sounds={sounds} mix={mix} scene={scene} uploads={uploads} onImport={importFiles} onDismiss={dismissUpload} onBack={() => setManage(null)} onChanged={loadSounds} onError={fail} error={error}
        onToggle={(id, mood, on) => update({ track: { id, mood, on } })} />
    )
  }
  const fire = (id: string) => { setError(''); request(socket, 'music:fx', { id, gain: fxGain }).catch(fail) }
  return (
    <div className="min-h-full bg-bg/40 pb-3 text-sm">
      <header className="relative h-44 bg-raised bg-cover bg-center" style={scene.image ? { backgroundImage: `url(/api/assets/${scene.image})` } : undefined}>
        <div className="absolute inset-0 bg-linear-to-t from-black/70 to-transparent" />
        <button aria-label={t('manageMusic')} title={t('manageMusic')} onClick={() => setManage(MOODS)} className="absolute top-3 right-3 grid size-10 place-items-center rounded-full bg-panel/90 text-ink shadow transition-transform hover:scale-105 active:scale-95"><Settings size={18} /></button>
        <div className="absolute inset-x-3 bottom-3 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <span className={`text-xs ${scene.active ? 'text-crit' : 'text-muted'}`}>{t(scene.active ? 'live' : 'preparing')}</span>
            <select aria-label={t('scene')} value={scene.id} onChange={(e) => setSceneId(e.target.value)} className="block w-full truncate rounded bg-transparent font-serif text-3xl text-white outline-none [&>option]:bg-panel [&>option]:text-base [&>option]:text-ink">
              {scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button aria-label={t(mix.paused ? 'resume' : 'pause')} title={t(mix.paused ? 'resume' : 'pause')} disabled={!hasSound} onClick={() => update({ paused: !mix.paused })}
            className="grid size-14 shrink-0 place-items-center rounded-full bg-accent text-bg shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:bg-panel/60 disabled:text-muted disabled:hover:scale-100">
            {mix.paused ? <Play size={24} fill="currentColor" /> : <Pause size={24} fill="currentColor" />}
          </button>
        </div>
      </header>

      {error && <p role="alert" className="px-3 pt-2 text-xs text-fumble">{error}</p>}
      <UploadList uploads={uploads} onDismiss={dismissUpload} />

      <section aria-label={t('music')} className="space-y-3 p-3">
        <h3 className="font-medium">{t('music')}</h3>
        <div role="radiogroup" aria-label={t('music')} className="flex gap-1">
          {[null, ...MOODS].map((m, i) => {
            const on = mix.mood === m
            const empty = m !== null && !mix.tracks[m].length && !sounds.some((s) => s.group === m && s.isDefault)
            return (
              <button key={m ?? 'off'} role="radio" aria-checked={on} disabled={empty} title={empty ? t('noTracks') : undefined} onClick={() => update({ mood: m })}
                className={`min-w-0 flex-1 truncate px-2 py-2.5 text-xs font-medium transition-all duration-200 active:scale-95 disabled:opacity-40 ${i === 0 ? 'max-w-14 rounded-l-3xl' : ''} ${i === 3 ? 'rounded-r-3xl' : ''} ${on ? 'rounded-3xl bg-accent text-bg' : 'rounded-lg bg-raised text-ink hover:bg-line'}`}>
                {t(m ?? 'off')}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">{t('intensity')}</span>
          <div role="radiogroup" aria-label={t('intensity')} className="flex h-5 flex-1 gap-1">
            {INTENSITIES.map((n) => (
              <button key={n} role="radio" aria-checked={mix.intensity === n} aria-label={`${t('intensity')} ${n + 1}`} onClick={() => update({ intensity: n })}
                className={`group grid flex-1 place-items-center transition-colors first:rounded-l-full last:rounded-r-full ${n <= mix.intensity ? 'bg-accent' : 'bg-raised hover:bg-line'}`}>
                <span className={`size-1.5 rounded-full ${n <= mix.intensity ? 'bg-bg' : 'bg-accent/70'}`} />
              </button>
            ))}
          </div>
        </div>
      </section>

      <div role="tablist" className="grid grid-cols-2 border-y border-line">
        {(['atmospheres', 'effects'] as const).map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`border-b-2 py-2.5 font-serif text-base transition-colors ${tab === id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'}`}>{t(id)}</button>
        ))}
      </div>

      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span>{tab === 'atmospheres' ? t('atmosphereCount', { n: inGroups(ATMOSPHERE_GROUPS).length }) : t('effectCount', { n: inGroups(EFFECT_GROUPS).length })}</span>
        <button className="font-medium text-accent hover:underline" onClick={() => setManage(tab === 'atmospheres' ? ATMOSPHERE_GROUPS : EFFECT_GROUPS)}>{t('manage')}</button>
      </div>

      {tab === 'atmospheres'
        ? ATMOSPHERE_GROUPS.map((group) => {
            const rows = inGroups([group])
            return rows.length > 0 && (
              <section key={group} aria-label={t(group)} className="space-y-1.5 px-3 pt-2">
                <h4 className="font-medium">{t(group)}</h4>
                {rows.map((s) => {
                  const level = mix.levels[s.id] ?? 0
                  return (
                    <div key={s.id} className={`flex items-center gap-3 rounded-xl p-2.5 transition-colors ${level ? 'bg-accent/15' : 'bg-raised/60'}`}>
                      <Badge icon={iconOf(s)} />
                      <span className="min-w-0 flex-1 truncate" title={s.name}>{s.name}</span>
                      <div role="radiogroup" aria-label={s.name} className="flex shrink-0 gap-0.5">
                        {LEVELS.map((l, i) => (
                          <button key={l.level} role="radio" aria-checked={level === l.level} aria-label={`${s.name}: ${l.label}`} onClick={() => update({ level: { id: s.id, level: level === l.level ? 0 : l.level } })}
                            className={`h-8 w-9 text-xs font-medium transition-colors active:scale-95 ${i === 0 ? 'rounded-l-full' : ''} ${i === 2 ? 'rounded-r-full' : ''} ${level === l.level ? 'bg-accent text-bg' : 'bg-bg text-ink hover:bg-line'}`}>{l.label}</button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </section>
            )
          })
        : (
          <>
            <label className="flex items-center gap-2 px-3 pt-1 text-xs text-muted">
              <Volume2 size={14} aria-hidden /> {t('effectVolume')}
              <input type="range" min={0.1} max={1} step={0.05} value={fxGain} className="min-w-0 flex-1 accent-(--color-accent)" onChange={(e) => {
                const value = Number(e.target.value)
                setFxGain(value)
                try { localStorage.setItem(FX_VOLUME, String(value)) } catch {}
              }} />
            </label>
            {EFFECT_GROUPS.map((group) => {
              const rows = inGroups([group])
              return rows.length > 0 && (
                <section key={group} aria-label={t(group)} className="px-3 pt-3">
                  <h4 className="mb-1.5 font-medium">{t(group)}</h4>
                  <ul className="grid grid-cols-3 gap-2">
                    {rows.map((s) => (
                      <li key={s.id}>
                        <button title={s.name} onClick={() => fire(s.id)} className="flex w-full flex-col items-center gap-1.5 rounded-xl bg-raised/60 p-2.5 transition-all duration-100 hover:bg-raised active:scale-90 active:bg-accent/25">
                          <Badge icon={iconOf(s)} />
                          <span className="w-full truncate text-center text-xs">{s.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </>
        )}
      {!inGroups(tab === 'atmospheres' ? ATMOSPHERE_GROUPS : EFFECT_GROUPS).length && <p className="px-3 py-6 text-center text-xs text-muted">{t('empty')}</p>}
    </div>
  )
}

const clock = (seconds: number) => {
  const total = Math.ceil(seconds)
  return total < 60 ? `${total} s` : `${Math.floor(total / 60)} min ${total % 60} s`
}

// Fila de importação: cada arquivo mostra a etapa, o percentual e quanto falta.
function UploadList({ uploads, onDismiss, inset = true }: { uploads: Upload[]; onDismiss: (key: string) => void; inset?: boolean }) {
  const t = useTranslations('music')
  if (!uploads.length) return null
  return (
    <ul className={`space-y-1.5 ${inset ? 'px-3 pt-3' : ''}`}>
      {uploads.map(({ key, name, progress, error }) => {
        const percent = Math.floor((progress?.fraction ?? 0) * 100)
        const status = !progress ? t('queued') : percent >= 100 ? t('finishing') : t(progress.phase === 'sending' ? 'sending' : 'processing', { percent })
        return (
          <li key={key} className="animate-pop rounded-xl bg-raised/60 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
              {error && <button aria-label={t('dismiss')} title={t('dismiss')} className="shrink-0 text-muted hover:text-ink" onClick={() => onDismiss(key)}><X size={14} /></button>}
            </div>
            {error
              ? <p role="alert" className="mt-0.5 text-fumble">{error}</p>
              : (
                <>
                  <div role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="my-1.5 h-2 overflow-hidden rounded-full bg-bg">
                    <div className="h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out" style={{ transform: `scaleX(${progress?.fraction ?? 0})` }} />
                  </div>
                  <div className="flex justify-between gap-2 text-xs text-muted">
                    <span>{status}</span>
                    {progress && percent < 100 && <span className="tabular-nums">{progress.left === null ? t('estimating') : t('left', { time: clock(progress.left) })}</span>}
                  </div>
                </>
              )}
          </li>
        )
      })}
    </ul>
  )
}

const timecode = (seconds: number) => {
  const total = Math.round(seconds), minutes = Math.floor(total / 60) % 60, rest = String(total % 60).padStart(2, '0')
  return total >= 3600 ? `${Math.floor(total / 3600)}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

function RowAction({ label, danger, on, onClick, children }: { label: string; danger?: boolean; on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button aria-label={label} title={label} onClick={onClick} className={`grid size-10 shrink-0 place-items-center rounded-lg transition-colors active:scale-95 ${on ? 'bg-accent text-bg' : `text-muted hover:bg-line ${danger ? 'hover:text-fumble' : 'hover:text-ink'}`}`}>{children}</button>
}

// "Gerenciar": importar, renomear e apagar por grupo; música ainda escolhe em quais cenas toca.
function SoundManager({ groups, sounds, mix, scene, uploads, error, onImport, onDismiss, onBack, onChanged, onToggle, onError }: {
  groups: Manage; sounds: Sound[]; mix: SoundMix; scene: SceneRow; uploads: Upload[]; error: string
  onImport: (group: SoundGroup, files: File[]) => void; onDismiss: (key: string) => void
  onBack: () => void; onChanged: () => Promise<unknown>; onToggle: (id: string, mood: Mood, on: boolean) => void; onError: (e: unknown) => void
}) {
  const { socket, campaignId } = useRealtime()
  const t = useTranslations('music')
  const [listening, setListening] = useState<string | null>(null)
  const [over, setOver] = useState<SoundGroup | null>(null)
  const moods = MOODS as readonly SoundGroup[]
  const isMusic = groups === moods
  const title = t(isMusic ? 'manageMusic' : groups === ATMOSPHERE_GROUPS ? 'manageAtmospheres' : 'manageEffects')

  const rename = async (s: Sound) => {
    const name = await askText(t('rename'), s.name)
    if (name) renameItem(campaignId, 'audio', s.id, name).then(onChanged).catch(onError)
  }
  const remove = async (s: Sound) => {
    if (await ask(t('deleteConfirm', { name: s.name }), t('delete'))) deleteAudio(campaignId, s.id).then(() => Promise.all([onChanged(), request(socket, 'music:sync')])).catch(onError)
  }
  const pick = (group: SoundGroup) => (
    <input type="file" accept="audio/*" multiple aria-label={`${t('import')}: ${t(group)}`} className="sr-only" onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) onImport(group, files) }} />
  )
  const label = (s: Sound) => (
    <span className="min-w-0 flex-1">
      <span className="line-clamp-2 leading-snug font-medium" title={s.name}>{s.name}</span>
      <span className="flex items-center gap-2 text-xs text-muted">
        {s.duration !== null && <span className="tabular-nums">{timecode(s.duration)}</span>}
        {s.isDefault && <span className="rounded-full bg-line px-2 py-0.5 text-[11px]">{t('default')}</span>}
      </span>
    </span>
  )

  return (
    <div className="min-h-full bg-bg/40 pb-4">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-panel px-4 py-3">
        <button aria-label={t('back')} title={t('back')} onClick={onBack} className="grid size-10 shrink-0 place-items-center rounded-full bg-raised transition-colors hover:bg-line active:scale-95"><ArrowLeft size={18} /></button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-serif text-2xl leading-tight">{title}</h3>
          <p className="truncate text-sm text-muted">{scene.name}</p>
        </div>
      </header>

      <div className="space-y-4 p-4">
        {error && <p role="alert" className="text-sm text-fumble">{error}</p>}
        {isMusic && <p className="rounded-xl bg-accent/10 px-4 py-3 text-sm leading-relaxed">{t('manageHint', { scene: scene.name })}</p>}

        {groups.map((group) => {
          const rows = sounds.filter((s) => s.group === group)
          const music = moods.includes(group)
          const chosen = music ? rows.filter((s) => mix.tracks[group as Mood].includes(s.id)).length : 0
          return (
            <section key={group} aria-label={t(group)}
              onDragOver={(e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); e.stopPropagation(); setOver(group) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null) }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(null); if (e.dataTransfer.files.length) onImport(group, [...e.dataTransfer.files]) }}
              className={`overflow-hidden rounded-2xl border bg-panel/70 transition-colors ${over === group ? 'border-accent bg-accent/10' : 'border-line'}`}>
              <header className="flex items-center gap-3 border-b border-line px-4 py-3">
                <Badge icon={GROUP_ICONS[group]} />
                <div className="min-w-0 flex-1">
                  <h4 className="truncate font-serif text-xl leading-tight">{t(group)}</h4>
                  <p className="text-sm text-muted">{music ? t('musicCount', { chosen, n: rows.length }) : t('soundCount', { n: rows.length })}</p>
                </div>
                <label className="btn btn-primary shrink-0 cursor-pointer px-4 py-2.5"><Upload size={16} aria-hidden /> {t('import')}{pick(group)}</label>
              </header>

              <div className="space-y-2 p-3 empty:hidden">
                <UploadList uploads={uploads.filter((u) => u.group === group)} onDismiss={onDismiss} inset={false} />
                {rows.length > 0
                  ? (
                    <ul className="space-y-2">
                      {rows.map((s) => {
                        const on = music && mix.tracks[group as Mood].includes(s.id)
                        return (
                          <li key={s.id} className={`rounded-xl border p-2 pl-3 transition-colors ${on ? 'border-accent/50 bg-accent/10' : 'border-transparent bg-raised/50 hover:bg-raised'}`}>
                            <div className="flex items-center gap-1">
                              {music
                                ? (
                                  <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 pr-2">
                                    <input type="checkbox" aria-label={t('inScene', { name: s.name })} checked={on} className="size-5 shrink-0 accent-(--color-accent)" onChange={(e) => onToggle(s.id, group as Mood, e.target.checked)} />
                                    {label(s)}
                                  </label>
                                )
                                : <div className="flex min-h-11 min-w-0 flex-1 items-center gap-3 pr-2"><Badge icon={iconOf(s)} size="size-10" />{label(s)}</div>}
                              <RowAction label={t(listening === s.id ? 'stopPreview' : 'preview', { name: s.name })} on={listening === s.id} onClick={() => setListening(listening === s.id ? null : s.id)}>
                                {listening === s.id ? <Square size={16} fill="currentColor" /> : <Headphones size={18} />}
                              </RowAction>
                              {!s.isDefault && (
                                <>
                                  <RowAction label={t('rename')} onClick={() => rename(s)}><Pencil size={18} /></RowAction>
                                  <RowAction label={t('delete')} danger onClick={() => remove(s)}><Trash2 size={18} /></RowAction>
                                </>
                              )}
                            </div>
                            {listening === s.id && <audio controls autoPlay src={`/api/assets/${s.id}`} onEnded={() => setListening(null)} className="mt-2 mb-1 h-10 w-full" />}
                          </li>
                        )
                      })}
                    </ul>
                  )
                  : !uploads.some((u) => u.group === group) && (
                    <label className="block cursor-pointer rounded-xl border-2 border-dashed border-line px-4 py-6 text-center text-sm text-muted transition-colors hover:border-accent/70 hover:text-ink">
                      {t('dropHere')}{pick(group)}
                    </label>
                  )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
