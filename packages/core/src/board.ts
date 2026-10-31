// Regras do tabuleiro (SDD §6): grid, distância, combate e o que cada membro recebe da cena.
import type { Member } from './permissions.ts'
import { can } from './permissions.ts'
import { cryptoRng, type Rng } from './dice.ts'

// `size` é a escala da cena (tamanho do token, régua, luz) e vale mesmo com `show` desligado; `show` liga as linhas e o encaixe.
export type Grid = { show: boolean; size: number; offsetX: number; offsetY: number; color: string; unit: number; diagonal: '1:1' | '5-10-5' }
export const DEFAULT_GRID: Grid = { show: false, size: 70, offsetX: 0, offsetY: 0, color: '#ffffff33', unit: 1.5, diagonal: '1:1' }
// Padrão sensato: personagem de jogador já entra com tocha, para o modo masmorra funcionar sem configurar.
export const defaultTorch = (g: Grid) => ({ bright: g.size * 4, dim: g.size * 8, color: '#ffaa44' })

// Nomes de campo que o tabuleiro e o combate procuram na ficha (SDD "Combate": vêm da ficha se tiverem os nomes sugeridos).
// Efeitos do token: condições do D&D 5e (PHB, apêndice A), já na língua da mesa, e estados comuns de jogo.
// `name` é o que fica gravado em `conditions`; `icon` é um nome do lucide e `color` o fundo do selo no token.
export const EFFECTS = [
  { name: 'agarrado', icon: 'grab', color: '#a8672f' },
  { name: 'amedrontado', icon: 'ghost', color: '#6b5b95' },
  { name: 'atordoado', icon: 'zap', color: '#c79a1e' },
  { name: 'caído', icon: 'arrow-down-to-line', color: '#7a6a58' },
  { name: 'cego', icon: 'eye-off', color: '#4a4f5c' },
  { name: 'contido', icon: 'link', color: '#6d7480' },
  { name: 'enfeitiçado', icon: 'heart', color: '#c2478a' },
  { name: 'envenenado', icon: 'biohazard', color: '#4f9a3c' },
  { name: 'exaustão', icon: 'battery-low', color: '#a35d3a' },
  { name: 'incapacitado', icon: 'ban', color: '#a83e3e' },
  { name: 'inconsciente', icon: 'moon', color: '#35508c' },
  { name: 'invisível', icon: 'venetian-mask', color: '#5c8fa8' },
  { name: 'paralisado', icon: 'person-standing', color: '#9a8428' },
  { name: 'petrificado', icon: 'mountain-snow', color: '#7c8088' },
  { name: 'surdo', icon: 'ear-off', color: '#5e6470' },
  { name: 'concentrando', icon: 'brain', color: '#3f8f8f' },
  { name: 'sangrando', icon: 'droplets', color: '#b02a37' },
  { name: 'queimando', icon: 'flame', color: '#d9631e' },
  { name: 'congelado', icon: 'snowflake', color: '#3f93c9' },
  { name: 'amaldiçoado', icon: 'skull', color: '#5a3473' },
  { name: 'abençoado', icon: 'sparkles', color: '#b8962e' },
  { name: 'protegido', icon: 'shield', color: '#3c7ab0' },
  { name: 'acelerado', icon: 'wind', color: '#3a9c86' },
  { name: 'lento', icon: 'turtle', color: '#6e7f3a' },
] as const

export const FIELD = { hp: 'pv_atual', hpMax: 'pv_max', ac: 'ca', defense: 'defesa', dc: 'cd_magia', speed: 'deslocamento', init: 'iniciativa', dex: 'mod_destreza' } as const

// Encaixe no grid: o canto do token cai no canto de uma célula.
export function snap(v: number, size: number, offset: number) {
  return Math.round((v - offset) / size) * size + offset
}

// Distância em células entre dois pontos; 5-10-5 cobra a cada segunda diagonal em dobro.
export function cells(ax: number, ay: number, bx: number, by: number, g: Pick<Grid, 'size' | 'diagonal'>) {
  const dx = Math.abs(bx - ax) / g.size, dy = Math.abs(by - ay) / g.size
  const hi = Math.max(dx, dy), lo = Math.min(dx, dy)
  return g.diagonal === '5-10-5' ? hi + Math.floor(lo / 2) : hi
}

export function pathCells(points: number[], g: Pick<Grid, 'size' | 'diagonal'>) {
  let total = 0
  for (let i = 2; i < points.length; i += 2) total += cells(points[i - 2]!, points[i - 1]!, points[i]!, points[i + 1]!, g)
  return total
}

// Como o token chega ao cliente: "envenenado" ou, vindo do combate, "envenenado (3)".
export function effectOf(condition: string) {
  const [, name = '', rounds] = /^(.*?)(?: \((\d+)\))?$/s.exec(condition)!
  return { name, rounds, effect: EFFECTS.find((e) => e.name === name.toLowerCase()) }
}

// --- Combate (C1–C8) ---
export type HpMode = 'exact' | 'status' | 'none'
export type Condition = { name: string; rounds?: number | null }
export type Combatant = {
  id: string
  tokenId?: string | null
  name: string
  init: number | null
  hp?: number | null // NPC sem ficha guarda a vida aqui
  hpMax?: number | null
  ac?: number | null // sobrepõe a CA da ficha (NPC, ou Escudo arcano no meio da luta)
  dc?: number | null // idem para a CD de magia
  hpMode: HpMode
  hidden: boolean
  conditions: Condition[]
  moved: number // células andadas no turno atual (C8)
}
// O que "próximo turno" apaga e "voltar turno" devolve: o deslocamento de quem saiu e as condições vencidas na virada.
export type TurnUndo = { id: string; moved: number; expired: { id: string; name: string }[] }
export type Combat = { round: number; turn: number; combatants: Combatant[]; undo?: TurnUndo[] }
// ponytail: o histórico vai no JSON da cena, então só os últimos passos voltam com tudo; além disso volta só a vez.
const UNDO_MAX = 100

// Efeitos de quem está em combate: os do combatente (com duração) somados aos do token, sem repetir nome.
export const mergeConditions = (token: string[], combat: Condition[]): Condition[] =>
  [...combat, ...token.filter((n) => !combat.some((k) => k.name.toLowerCase() === n.toLowerCase())).map((name) => ({ name }))]

// Liga ou desliga um efeito. Ao desligar, sai do token e do combate; ao ligar, fica no token até alguém tirar.
export function toggleEffect(name: string, conditions: string[], combat: Combat | null, tokenId: string) {
  const same = (x: string) => x.toLowerCase() === name.toLowerCase()
  const on = conditions.some(same) || !!combat?.combatants.some((c) => c.tokenId === tokenId && c.conditions.some((k) => same(k.name)))
  if (!on) return { conditions: [...conditions, name], combat }
  return {
    conditions: conditions.filter((x) => !same(x)),
    combat: combat && { ...combat, combatants: combat.combatants.map((c) => (c.tokenId === tokenId ? { ...c, conditions: c.conditions.filter((k) => !same(k.name)) } : c)) },
  }
}

// Empate é estável: sem regra de sistema, vale a ordem da lista (o sorteio da rolagem ou o arraste do mestre).
export const sortByInit = (cs: Combatant[]) => [...cs].sort((a, b) => (b.init ?? -Infinity) - (a.init ?? -Infinity))

export function shuffle<T>(xs: T[], rng: Rng = cryptoRng) {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1) - 1
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

// Nova ordem sem tirar a vez de quem está jogando; antes do primeiro "próximo turno", a vez é de quem ficou no topo.
export function reorder(c: Combat, combatants: Combatant[]): Combat {
  if (c.round === 1 && c.turn === 0) return { ...c, combatants, turn: 0 }
  const cur = c.combatants[c.turn]?.id
  return { ...c, combatants, turn: Math.max(0, combatants.findIndex((x) => x.id === cur)) }
}

// Avança o turno; ao virar a rodada, condições com duração perdem uma rodada e vencem sozinhas (C5).
export function nextTurn(c: Combat): Combat {
  if (!c.combatants.length) return c
  const combatants = c.combatants.map((x) => ({ ...x, moved: 0 }))
  const out = c.combatants[c.turn]!
  const undo = (expired: TurnUndo['expired']) => [...(c.undo ?? []), { id: out.id, moved: out.moved, expired }].slice(-UNDO_MAX)
  if (c.turn + 1 < combatants.length) return { ...c, turn: c.turn + 1, combatants, undo: undo([]) }
  return {
    round: c.round + 1,
    turn: 0,
    combatants: combatants.map((x) => ({
      ...x,
      conditions: x.conditions.flatMap((k) => (k.rounds == null ? [k] : k.rounds > 1 ? [{ ...k, rounds: k.rounds - 1 }] : [])),
    })),
    undo: undo(combatants.flatMap((x) => x.conditions.filter((k) => k.rounds != null && k.rounds <= 1).map((k) => ({ id: x.id, name: k.name })))),
  }
}

// Desfaz o último "próximo turno": a duração volta a subir, e nextTurn depois disso recai nos mesmos números.
export function prevTurn(c: Combat): Combat {
  const wrap = c.turn === 0
  if (wrap && c.round === 1) return c
  const step = c.undo?.at(-1)
  const back = { ...c, round: wrap ? c.round - 1 : c.round, turn: wrap ? Math.max(0, c.combatants.length - 1) : c.turn - 1, undo: c.undo?.slice(0, -1) }
  if (!step) return back
  return {
    ...back,
    combatants: c.combatants.map((x) => {
      const expired = step.expired.filter((e) => e.id === x.id && !x.conditions.some((k) => k.name === e.name)).map((e) => ({ name: e.name, rounds: 1 }))
      return {
        ...x,
        moved: x.id === step.id ? step.moved : x.moved,
        conditions: wrap ? [...x.conditions.map((k) => (k.rounds == null ? k : { ...k, rounds: k.rounds + 1 })), ...expired] : x.conditions,
      }
    }),
  }
}

// "-7" dano, "+5" cura, "12" valor exato.
export function applyHp(current: number, input: string, max?: number | null) {
  const s = input.trim().replace(',', '.')
  const n = Number(s.replace(/^[+-]/, ''))
  if (!s || !Number.isFinite(n)) throw new Error('Use -7 para dano, +5 para cura ou um número')
  const v = s.startsWith('-') ? current - n : s.startsWith('+') ? current + n : n
  return Math.max(0, max != null && s.startsWith('+') ? Math.min(v, max) : v)
}

export function hpStatus(hp: number, max: number) {
  if (hp <= 0) return 'caído'
  if (hp >= max) return 'ileso'
  return hp / max > 0.5 ? 'ferido' : 'muito ferido'
}

export type CombatantView = Omit<Combatant, 'hp' | 'hpMax' | 'ac' | 'dc'> & { hp?: number | null; hpMax?: number | null; ac?: number | null; dc?: number | null; status?: string; current: boolean; image?: string | null; pc?: boolean }

// O que cada um vê do combate: escondidos somem para jogadores (C7) e a vida segue o modo (C6) — sem número quando oculto.
export function viewCombat(c: Combat, member: Member, hpOf: (x: Combatant) => { hp: number | null; max: number | null; ac?: number | null; dc?: number | null }, owns: (x: Combatant) => boolean, look: (x: Combatant) => { image?: string | null; pc?: boolean; conditions?: Condition[] } = () => ({})) {
  const gm = member.role === 'gm'
  const current = c.combatants[c.turn]?.id
  const combatants = c.combatants.flatMap((x): CombatantView[] => {
    if (x.hidden && !gm) return []
    const { hp, max, ac, dc } = hpOf(x)
    const { hp: _hp, hpMax: _max, ac: _ac, dc: _dc, ...rest } = x
    const base: CombatantView = { ...rest, ...look(x), current: x.id === current }
    // CA e CD de inimigo são segredo do mestre: o jogador só vê as dos próprios personagens.
    if (gm || owns(x)) return [{ ...base, hp, hpMax: max, ac, dc }]
    if (x.hpMode === 'exact') return [{ ...base, hp, hpMax: max }]
    if (x.hpMode === 'status' && hp != null && max) return [{ ...base, status: hpStatus(hp, max) }]
    return [base]
  })
  return { round: c.round, combatants }
}

// --- Visibilidade de tokens, desenhos e pins ---
export type TokenLike = { layer: 'tokens' | 'gm' }
export const tokenVisible = (t: TokenLike, m: Member) => t.layer !== 'gm' || can(m, 'gmLayer.view', null)

export type PinLike = { visibility: 'all' | 'gm' | 'some'; visibleTo: string[] }
// P5/P6: pin só do mestre nunca sai do servidor para jogadores.
export const pinVisible = (p: PinLike, m: Member) => m.role === 'gm' || p.visibility === 'all' || (p.visibility === 'some' && p.visibleTo.includes(m.userId))
