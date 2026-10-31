// Avaliador seguro de fórmulas de ficha (SDD F5): só aritmética, floor/ceil/min/max e nomes de campo (com ou sem @).

export class FormulaError extends Error {}

type Node =
  | { t: 'num'; v: number }
  | { t: 'ref'; name: string }
  | { t: 'neg'; e: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] }

const FNS: Record<string, (...a: number[]) => number> = { floor: Math.floor, ceil: Math.ceil, min: Math.min, max: Math.max }
const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|@?([a-z_][\w.]*)|(\S))/iy

export function parseFormula(src: string): Node {
  const toks: { num?: number; id?: string; op?: string }[] = []
  TOKEN.lastIndex = 0
  for (let m; TOKEN.lastIndex < src.length && (m = TOKEN.exec(src)); ) {
    if (m[1]) toks.push({ num: Number(m[1]) })
    else if (m[2]) toks.push({ id: m[2] })
    else if (m[3]) toks.push({ op: m[3] })
  }
  let i = 0
  const peek = () => toks[i]?.op
  const expect = (op: string) => {
    if (toks[i]?.op !== op) throw new FormulaError(`Esperava "${op}" na fórmula`)
    i++
  }
  const expr = (): Node => {
    let a = term()
    while (peek() === '+' || peek() === '-') a = { t: 'bin', op: toks[i++]!.op!, a, b: term() }
    return a
  }
  const term = (): Node => {
    let a = unary()
    while (peek() === '*' || peek() === '/') a = { t: 'bin', op: toks[i++]!.op!, a, b: unary() }
    return a
  }
  const unary = (): Node => (peek() === '-' ? (i++, { t: 'neg', e: unary() }) : primary())
  const primary = (): Node => {
    const tok = toks[i++]
    if (!tok) throw new FormulaError('Fórmula incompleta')
    if (tok.num !== undefined) return { t: 'num', v: tok.num }
    if (tok.op === '(') {
      const e = expr()
      expect(')')
      return e
    }
    if (tok.id !== undefined) {
      if (peek() !== '(') return { t: 'ref', name: tok.id }
      const fn = tok.id.toLowerCase()
      if (!FNS[fn]) throw new FormulaError(`Função desconhecida: ${tok.id}`)
      i++
      const args = [expr()]
      while (peek() === ',') (i++, args.push(expr()))
      expect(')')
      return { t: 'call', fn, args }
    }
    throw new FormulaError(`Símbolo inesperado: "${tok.op}"`)
  }
  const root = expr()
  if (i < toks.length) throw new FormulaError(`Sobrou algo no fim da fórmula`)
  return root
}

export function dependencies(n: Node, out = new Set<string>()): Set<string> {
  if (n.t === 'ref') out.add(n.name)
  else if (n.t === 'neg') dependencies(n.e, out)
  else if (n.t === 'bin') (dependencies(n.a, out), dependencies(n.b, out))
  else if (n.t === 'call') n.args.forEach((a) => dependencies(a, out))
  return out
}

export function evaluate(n: Node, get: (name: string) => number): number {
  switch (n.t) {
    case 'num': return n.v
    case 'ref': return get(n.name)
    case 'neg': return -evaluate(n.e, get)
    case 'call': return FNS[n.fn]!(...n.args.map((a) => evaluate(a, get)))
    case 'bin': {
      const a = evaluate(n.a, get), b = evaluate(n.b, get)
      if (n.op === '/' && b === 0) throw new FormulaError('Divisão por zero')
      return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : a / b
    }
  }
}

export type SheetField = { name: string; formula?: string }

// Calcula todos os campos com fórmula de uma ficha. Erros (incluindo ciclo) vão por campo, sem derrubar os outros.
export function computeSheet(fields: SheetField[], values: Record<string, number>) {
  const formulas = new Map(fields.filter((f) => f.formula).map((f) => [f.name, f.formula!]))
  const out: Record<string, number> = { ...values }
  const errors: Record<string, string> = {}
  const state = new Map<string, 'visiting' | 'done'>()

  const resolve = (name: string): number => {
    const formula = formulas.get(name)
    if (!formula) {
      if (!(name in out)) throw new FormulaError(`Campo "${name}" não existe`)
      return out[name]!
    }
    if (state.get(name) === 'done') {
      if (name in errors) throw new FormulaError(`Depende de "${name}", que tem erro`)
      return out[name]!
    }
    if (state.get(name) === 'visiting') throw new FormulaError(`Dependência circular em "${name}"`)
    state.set(name, 'visiting')
    try {
      out[name] = evaluate(parseFormula(formula), resolve)
      return out[name]!
    } catch (e) {
      errors[name] = (e as Error).message
      delete out[name]
      throw e
    } finally {
      state.set(name, 'done')
    }
  }

  for (const name of formulas.keys()) {
    try { resolve(name) } catch {}
  }
  return { values: out, errors }
}
