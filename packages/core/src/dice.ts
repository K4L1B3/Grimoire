// Parser e rolagem de dados (SDD D1). A rolagem acontece só no servidor; o cliente apenas anima o resultado.

export class DiceError extends Error {}

export type Die = { value: number; dropped?: true; exploded?: true; success?: boolean }
export type Term =
  | { kind: 'dice'; sign: 1 | -1; count: number; sides: number; dice: Die[]; value: number }
  | { kind: 'number'; sign: 1 | -1; value: number }
  | { kind: 'ref'; sign: 1 | -1; name: string; value: number }
export type RollResult = { formula: string; terms: Term[]; total: number; crit: boolean; fumble: boolean }
export type Rng = (sides: number) => number

const MAX_DICE = 100
const MAX_SIDES = 1000
const MAX_EXPLOSIONS = 100

// sinal, NdS, kh/kl N, !, alvo de sucesso | número | @campo
const TERM = /\s*([+-])?\s*(?:(\d*)d(\d+)(?:(kh|kl)(\d+))?(!)?(?:(>=|<=|>|<)(\d+))?|(\d+)|@([a-z_][\w.]*))\s*/iy

// Web Crypto (Node e navegador) com rejeição, para não enviesar o dado.
export const cryptoRng: Rng = (sides) => {
  const limit = 2 ** 32 - (2 ** 32 % sides)
  const buf = new Uint32Array(1)
  do crypto.getRandomValues(buf)
  while (buf[0]! >= limit)
  return (buf[0]! % sides) + 1
}

export function roll(formula: string, refs: Record<string, number> = {}, rng: Rng = cryptoRng): RollResult {
  const src = formula.trim()
  if (!src) throw new DiceError('Rolagem vazia')
  const terms: Term[] = []
  TERM.lastIndex = 0
  while (TERM.lastIndex < src.length) {
    const at = TERM.lastIndex
    const m = TERM.exec(src)
    if (!m || (terms.length > 0 && !m[1])) throw new DiceError(`Não entendi a rolagem perto de "${src.slice(at)}"`)
    const sign = m[1] === '-' ? -1 : 1
    if (m[3] !== undefined) terms.push(rollDice(m, sign, rng))
    else if (m[9] !== undefined) terms.push({ kind: 'number', sign, value: Number(m[9]) })
    else {
      const name = m[10]!
      if (!(name in refs)) throw new DiceError(`O campo @${name} não existe nesta ficha`)
      terms.push({ kind: 'ref', sign, name, value: refs[name]! })
    }
  }
  const kept = (t: Term) => (t.kind === 'dice' && t.sides === 20 ? t.dice.filter((d) => !d.dropped) : [])
  return {
    formula,
    terms,
    total: terms.reduce((s, t) => s + t.sign * t.value, 0),
    crit: terms.some((t) => kept(t).some((d) => d.value === 20)),
    fumble: terms.some((t) => kept(t).some((d) => d.value === 1)),
  }
}

function rollDice(m: RegExpExecArray, sign: 1 | -1, rng: Rng): Term {
  const count = m[2] ? Number(m[2]) : 1
  const sides = Number(m[3])
  const [keep, keepN, explode, cmp, target] = [m[4]?.toLowerCase(), Number(m[5]), !!m[6], m[7], Number(m[8])]
  if (count < 1 || count > MAX_DICE) throw new DiceError(`Use entre 1 e ${MAX_DICE} dados`)
  if (sides < 2 || sides > MAX_SIDES) throw new DiceError(`O dado precisa ter entre 2 e ${MAX_SIDES} lados`)
  if (keep && (keepN < 1 || keepN > count)) throw new DiceError(`Não dá para manter ${keepN} de ${count} dados`)

  const dice: Die[] = []
  let explosions = 0
  for (let i = 0; i < count; i++) {
    let v = rng(sides)
    dice.push({ value: v })
    while (explode && v === sides) {
      if (++explosions > MAX_EXPLOSIONS) throw new DiceError('Explosões demais nessa rolagem')
      v = rng(sides)
      dice.push({ value: v, exploded: true })
    }
  }

  if (keep) {
    const order = dice.map((d, i) => i).sort((a, b) => (keep === 'kh' ? dice[b]!.value - dice[a]!.value : dice[a]!.value - dice[b]!.value))
    for (const i of order.slice(keepN)) dice[i]!.dropped = true
  }

  const live = dice.filter((d) => !d.dropped)
  let value: number
  if (cmp) {
    const hit = { '>=': (v: number) => v >= target, '<=': (v: number) => v <= target, '>': (v: number) => v > target, '<': (v: number) => v < target }[cmp]!
    for (const d of live) d.success = hit(d.value)
    value = live.filter((d) => d.success).length
  } else {
    value = live.reduce((s, d) => s + d.value, 0)
  }
  return { kind: 'dice', sign, count, sides, dice, value }
}
