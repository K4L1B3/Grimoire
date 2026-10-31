// Valores que um ator expõe para rolagens e fórmulas: ficha principal como @campo, as outras como @alias.campo (F5, F12).
import { computeSheet, type SheetField } from './formula.ts'

export type ActorSheet = { alias: string | null; fields: SheetField[]; values: Record<string, unknown> }

export const numeric = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).flatMap(([k, v]) => {
    const n = typeof v === 'boolean' ? Number(v) : typeof v === 'string' && v.trim() !== '' ? Number(v) : v
    return typeof n === 'number' && Number.isFinite(n) ? [[k, n]] : []
  }))

// ponytail: referência entre fichas resolve um nível (@companheiro.forca lê o valor já calculado da outra ficha); cadeia entre fichas não recalcula em ciclo
export function actorRefs(sheets: ActorSheet[]): Record<string, number> {
  const own = sheets.map((s) => ({ s, v: computeSheet(s.fields, numeric(s.values)).values }))
  const shared: Record<string, number> = {}
  for (const { s, v } of own) if (s.alias) for (const [k, n] of Object.entries(v)) shared[`${s.alias}.${k}`] = n
  const main = sheets.find((s) => !s.alias) ?? sheets[0]
  if (!main) return shared
  return { ...shared, ...computeSheet(main.fields, { ...numeric(main.values), ...shared }).values }
}
