// Molde de ficha (SDD §5): campos em fração da página (0–1), nunca em pixels.
import { z } from 'zod'
import { dependencies, parseFormula } from './formula.ts'

export const FIELD_TYPES = ['text', 'textarea', 'number', 'checkbox', 'counter', 'image', 'list'] as const
export type FieldType = (typeof FIELD_TYPES)[number]

const frac = z.number().min(0).max(1)
export const FieldSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/, 'Use letras minúsculas, números e _').max(40),
  type: z.enum(FIELD_TYPES),
  page: z.number().int().min(0).max(500),
  x: frac, y: frac, w: frac, h: frac,
  formula: z.string().max(500).optional(),
  // Valor inicial de toda ficha nova (o que o mestre digita no molde).
  default: z.union([z.string().max(2000), z.number(), z.boolean()]).optional(),
  roll: z.string().max(200).optional(),
  style: z.object({
    font: z.enum(['sans', 'serif', 'mono', 'hand']).optional(),
    size: z.number().min(4).max(96).nullable().optional(), // null = ajuste automático
    align: z.enum(['left', 'center', 'right']).optional(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  }).optional(),
  // Grupo repetível (F7): colunas em fração da largura do campo; cada linha tem rowH da altura da página.
  columns: z.array(z.object({ name: z.string().regex(/^[a-z_][a-z0-9_]*$/).max(40), type: z.enum(['text', 'number', 'checkbox']), w: frac })).max(12).optional(),
  rowH: z.number().min(0.005).max(0.2).optional(),
})
export type Field = z.infer<typeof FieldSchema>

export const FieldsSchema = z.array(FieldSchema).max(1000).superRefine((fs, ctx) => {
  const seen = new Set<string>()
  for (const f of fs) {
    if (seen.has(f.name)) ctx.addIssue({ code: 'custom', message: `Nome repetido: ${f.name}` })
    seen.add(f.name)
  }
})

// "Força" → "forca", "PV Máximo" → "pv_maximo" (SDD F2: o app sugere o nome lendo o PDF).
export function slugify(label: string) {
  const s = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  return /^[a-z_]/.test(s) ? s : s ? `_${s}`.slice(0, 40) : ''
}

export function uniqueName(base: string, taken: Iterable<string>) {
  const set = new Set(taken)
  const b = base || 'campo'
  if (!set.has(b)) return b
  for (let i = 2; ; i++) if (!set.has(`${b}_${i}`)) return `${b}_${i}`
}

// Para o "Mapa de campos" (F5): quem depende de cada campo, e erro de sintaxe por campo.
export function fieldMap(fields: Pick<Field, 'name' | 'formula'>[]) {
  const dependents = new Map<string, string[]>(fields.map((f) => [f.name, []]))
  const syntax: Record<string, string> = {}
  for (const f of fields) {
    if (!f.formula) continue
    try {
      for (const d of dependencies(parseFormula(f.formula))) dependents.get(d)?.push(f.name)
    } catch (e) {
      syntax[f.name] = (e as Error).message
    }
  }
  return { dependents, syntax }
}

// Ordem do Tab (F9): página, depois linha (com tolerância), depois coluna.
export const tabOrder = <T extends Pick<Field, 'page' | 'x' | 'y'>>(fields: T[]) =>
  [...fields].sort((a, b) => a.page - b.page || (Math.abs(a.y - b.y) > 0.01 ? a.y - b.y : a.x - b.x))

export const REMOVED_KEY = '__removed'
const RETAIN_MS = 30 * 24 * 3600 * 1000

// Quando o molde muda, valores de campos removidos ficam guardados por 30 dias e voltam se o campo voltar.
export function reconcileValues(values: Record<string, unknown>, names: Set<string>, now = Date.now()) {
  const removed = { ...((values[REMOVED_KEY] ?? {}) as Record<string, { v: unknown; at: number }>) }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (k === REMOVED_KEY) continue
    if (names.has(k)) out[k] = v
    else removed[k] = { v, at: now }
  }
  for (const [k, r] of Object.entries(removed)) {
    if (names.has(k) && !(k in out)) { out[k] = r.v; delete removed[k] }
    else if (now - r.at > RETAIN_MS) delete removed[k]
  }
  if (Object.keys(removed).length) out[REMOVED_KEY] = removed
  return out
}
