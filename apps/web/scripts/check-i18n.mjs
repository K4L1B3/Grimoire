// Confere que toda chave usada em t('…') existe em pt.json e en.json (roda no CI junto com o typecheck).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const cat = Object.fromEntries(['pt', 'en'].map((l) => [l, JSON.parse(readFileSync(`messages/${l}.json`, 'utf8'))]))
const has = (o, key) => key.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o) !== undefined
const files = (d) => readdirSync(d).flatMap((f) => (f === 'node_modules' || f.startsWith('.') ? [] : statSync(path.join(d, f)).isDirectory() ? files(path.join(d, f)) : /\.tsx?$/.test(f) ? [path.join(d, f)] : []))

let bad = 0
for (const file of [...files('app'), ...files('components')]) {
  const src = readFileSync(file, 'utf8')
  const vars = new Map([...src.matchAll(/const (\w+) = (?:await )?(?:useTranslations|getTranslations)\('(\w+)'\)/g)].map((m) => [m[1], m[2]]))
  for (const m of src.matchAll(/useTranslations\('(\w+)'\)\('([\w.]+)'\)/g)) vars.set(`inline:${m[2]}`, m[1])
  for (const [v, ns] of vars) {
    const calls = v.startsWith('inline:') ? [[null, v.slice(7)]] : [...src.matchAll(new RegExp(`\\b${v}(?:\\.rich)?\\('([\\w.]+)'`, 'g'))]
    for (const [, key] of calls) for (const l of ['pt', 'en']) if (!has(cat[l][ns], key)) (console.log(`${file}: ${ns}.${key} falta em ${l}`), bad++)
  }
}
process.exit(bad ? 1 : 0)
