import 'server-only'
// Exportar e importar a wiki (W12): Markdown + imagens para ler (e alimentar IA),
// e campanha.json com os documentos Yjs para reimportar sem perder nada.
import path from 'node:path'
import * as Y from 'yjs'
import { strToU8, unzipSync, zipSync, strFromU8 } from 'fflate'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db, asset, board, page, pin, secretBlock, timelineEvent, worldMap, yDoc } from '@grimorio/db'
import { getFile, putFile } from './storage'

type PageRow = typeof page.$inferSelect
const ASSET = /\/api\/assets\/([0-9a-f-]{36})/g

export async function exportCampaign(campaignId: string) {
  // Notas pessoais não entram: quem exporta é o mestre, e elas são só do dono.
  const pages = await db.select().from(page).where(and(eq(page.campaignId, campaignId), isNull(page.ownerId)))
  const ids = pages.map((p) => p.id)
  const secrets = ids.length ? await db.select().from(secretBlock).where(inArray(secretBlock.pageId, ids)) : []
  const names = [...ids.map((id) => `page:${id}`), ...secrets.map((s) => `secret:${s.id}`)]
  const docs = new Map((names.length ? await db.select().from(yDoc).where(inArray(yDoc.name, names)) : []).map((d) => [d.name, d.state]))
  const [timeline, boards, maps] = ids.length
    ? await Promise.all([
        db.select().from(timelineEvent).where(inArray(timelineEvent.pageId, ids)),
        db.select().from(board).where(inArray(board.pageId, ids)),
        db.select().from(worldMap).where(inArray(worldMap.pageId, ids)),
      ])
    : [[], [], []]
  const pins = maps.length ? await db.select().from(pin).where(inArray(pin.mapId, maps.map((m) => m.id))) : []

  const title = new Map(pages.map((p) => [p.id, p.title]))
  const files: Record<string, Uint8Array> = {}
  const usedAssets = new Set<string>()
  const json = JSON.stringify({ pages, secrets: secrets.map((s) => ({ ...s, searchText: undefined })), timeline, boards, maps, pins }, null, 1)
  for (const m of json.matchAll(ASSET)) usedAssets.add(m[1]!)
  for (const m of maps) usedAssets.add(m.assetId)
  for (const p of pins) if (p.imageAssetId) usedAssets.add(p.imageAssetId)

  // Um .md por página, em pastas que seguem a árvore.
  const pathOf = (p: PageRow): string => {
    const parent = p.parentId ? pages.find((x) => x.id === p.parentId) : undefined
    return `${parent ? `${pathOf(parent)}/` : ''}${safe(p.title)}`
  }
  const docJson: Record<string, string> = {}
  for (const p of pages) {
    const state = docs.get(`page:${p.id}`)
    let md = `# ${p.title}\n\n`
    if (state) {
      docJson[`page:${p.id}`] = Buffer.from(state).toString('base64')
      const frag = load(state).getXmlFragment('default')
      md += toMarkdown(frag, title, (id) => {
        const s = docs.get(`secret:${id}`)
        return s ? toMarkdown(load(s).getXmlFragment('default'), title, () => '') : ''
      })
      for (const m of md.matchAll(ASSET)) usedAssets.add(m[1]!)
    }
    for (const ev of timeline.filter((t) => t.pageId === p.id)) md += `- **${ev.date}** — ${ev.title}${ev.linkPageId ? ` ([[${title.get(ev.linkPageId) ?? ''}]])` : ''}\n`
    if (p.kind !== 'folder') files[`paginas/${pathOf(p)}.md`] = strToU8(md.replace(ASSET, (_, id) => `${'../'.repeat(pathOf(p).split('/').length)}imagens/${id}.webp`))
  }
  for (const s of secrets) {
    const state = docs.get(`secret:${s.id}`)
    if (state) docJson[`secret:${s.id}`] = Buffer.from(state).toString('base64')
  }

  const assets = usedAssets.size ? await db.select().from(asset).where(and(eq(asset.campaignId, campaignId), inArray(asset.id, [...usedAssets]))) : []
  for (const a of assets) {
    try { files[`imagens/${a.id}${path.extname(a.storageKey)}`] = await getFile(a.storageKey) } catch {}
  }
  files['campanha.json'] = strToU8(JSON.stringify({ version: 1, ...JSON.parse(json), docs: docJson, assets: assets.map((a) => ({ id: a.id, kind: a.kind, name: a.name, mime: a.mime, ext: path.extname(a.storageKey), width: a.width, height: a.height })) }))
  return zipSync(files, { level: 6 })
}

type Dump = {
  version: 1
  pages: PageRow[]
  secrets: (typeof secretBlock.$inferSelect)[]
  timeline: (typeof timelineEvent.$inferSelect)[]
  boards: (typeof board.$inferSelect)[]
  maps: (typeof worldMap.$inferSelect)[]
  pins: (typeof pin.$inferSelect)[]
  docs: Record<string, string>
  assets: { id: string; kind: 'image' | 'pdf' | 'map'; name: string; mime: string; ext: string; width: number | null; height: number | null }[]
}

// Reimporta com ids novos: links [[ ]], segredos, imagens, cartões do quadro e pins apontam para os novos ids.
export async function importCampaign(campaignId: string, zip: Uint8Array) {
  const files = unzipSync(zip)
  if (!files['campanha.json']) throw new Error('Esse zip não foi exportado pelo Grimório')
  const d = JSON.parse(strFromU8(files['campanha.json'])) as Dump
  const ids = new Map<string, string>()
  const remap = (id: string | null | undefined) => (id ? (ids.get(id) ?? id) : id ?? null)
  for (const x of [...d.pages, ...d.secrets, ...d.assets, ...d.maps]) ids.set(x.id, crypto.randomUUID())

  for (const a of d.assets) {
    const data = files[`imagens/${a.id}${a.ext}`]
    if (!data) continue
    const storageKey = `${campaignId}/${ids.get(a.id)}${a.ext}`
    await putFile(storageKey, data, a.mime)
    await db.insert(asset).values({ id: ids.get(a.id)!, campaignId, kind: a.kind, name: a.name, mime: a.mime, storageKey, size: data.length, width: a.width, height: a.height })
  }
  const fixText = (s: string) => s.replace(ASSET, (_, id) => `/api/assets/${remap(id)}`)
  const fixDoc = (b64: string) => {
    const doc = load(Buffer.from(b64, 'base64'))
    walk(doc.getXmlFragment('default'), (el) => {
      for (const k of ['id']) if ((el.nodeName === 'pageLink' || el.nodeName === 'secretBlock') && el.getAttribute(k)) el.setAttribute(k, remap(String(el.getAttribute(k)))!)
      if (el.nodeName === 'image' && el.getAttribute('src')) el.setAttribute('src', fixText(String(el.getAttribute('src'))))
    })
    return Buffer.from(Y.encodeStateAsUpdate(doc))
  }

  await db.transaction(async (tx) => {
    for (const p of d.pages) await tx.insert(page).values({ ...p, id: ids.get(p.id)!, campaignId, parentId: remap(p.parentId), createdAt: undefined, updatedAt: undefined })
    for (const s of d.secrets) await tx.insert(secretBlock).values({ ...s, id: ids.get(s.id)!, pageId: remap(s.pageId)!, visibleTo: [] })
    for (const [name, b64] of Object.entries(d.docs)) {
      const [kind, id] = name.split(':')
      await tx.insert(yDoc).values({ name: `${kind}:${remap(id)}`, state: fixDoc(b64) })
    }
    for (const t of d.timeline) await tx.insert(timelineEvent).values({ ...t, id: crypto.randomUUID(), pageId: remap(t.pageId)!, linkPageId: remap(t.linkPageId) })
    for (const b of d.boards) {
      const els = Object.fromEntries(Object.entries(b.elements).map(([k, e]) => {
        const el = e as { customData?: { pageId?: string }; link?: string }
        return [k, { ...el, customData: el.customData?.pageId ? { pageId: remap(el.customData.pageId) } : el.customData, link: el.link?.replace(/[0-9a-f-]{36}$/, (x) => remap(x)!) }]
      }))
      await tx.insert(board).values({ pageId: remap(b.pageId)!, elements: els, files: JSON.parse(fixText(JSON.stringify(b.files ?? {}))) })
    }
    for (const m of d.maps) await tx.insert(worldMap).values({ id: ids.get(m.id)!, pageId: remap(m.pageId)!, assetId: remap(m.assetId)! })
    for (const p of d.pins) await tx.insert(pin).values({ ...p, id: crypto.randomUUID(), mapId: remap(p.mapId), sceneId: null, linkPageId: remap(p.linkPageId), imageAssetId: remap(p.imageAssetId), visibleTo: [] })
  })
  return { pages: d.pages.length }
}

function load(state: Uint8Array | Buffer) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, new Uint8Array(state))
  return doc
}

function walk(n: Y.XmlFragment | Y.XmlElement, fn: (el: Y.XmlElement) => void) {
  for (const c of n.toArray()) if (c instanceof Y.XmlElement) (fn(c), walk(c, fn))
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').trim() || 'sem-titulo'

// Converte o documento TipTap (em Yjs) para Markdown, sem precisar do schema do editor.
export function toMarkdown(frag: Y.XmlFragment | Y.XmlElement, title: Map<string, string>, secret: (id: string) => string): string {
  const inline = (el: Y.XmlElement): string => el.toArray().map((c) => {
    if (c instanceof Y.XmlText) {
      return (c.toDelta() as { insert: string; attributes?: Record<string, { href?: string }> }[]).map(({ insert, attributes: a = {} }) => {
        let t = insert
        if (a.code) t = `\`${t}\``
        if (a.bold) t = `**${t}**`
        if (a.italic) t = `*${t}*`
        if (a.strike) t = `~~${t}~~`
        if (a.link?.href) t = `[${t}](${a.link.href})`
        return t
      }).join('')
    }
    if (c instanceof Y.XmlElement && c.nodeName === 'pageLink') return `[[${title.get(String(c.getAttribute('id'))) ?? 'página'}]]`
    if (c instanceof Y.XmlElement && c.nodeName === 'hardBreak') return '  \n'
    return c instanceof Y.XmlElement ? inline(c) : ''
  }).join('')

  const block = (el: Y.XmlElement, indent = ''): string => {
    const kids = () => el.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement)
    switch (el.nodeName) {
      case 'paragraph': return indent + inline(el)
      case 'heading': return `${'#'.repeat(Number(el.getAttribute('level') ?? 2))} ${inline(el)}`
      case 'bulletList': return kids().map((li) => `${indent}- ${blocks(li, indent + '  ').trimStart()}`).join('\n')
      case 'orderedList': return kids().map((li, i) => `${indent}${i + 1}. ${blocks(li, indent + '   ').trimStart()}`).join('\n')
      case 'blockquote': return blocks(el).split('\n').map((l) => `> ${l}`).join('\n')
      case 'callout': return `> ${el.getAttribute('emoji') ?? '💡'} ${blocks(el).split('\n').join('\n> ')}`
      case 'codeBlock': return '```\n' + el.toArray().map((c) => c.toString()).join('') + '\n```'
      case 'horizontalRule': return '---'
      case 'image': return `![${el.getAttribute('alt') ?? ''}](${el.getAttribute('src') ?? ''})`
      case 'secretBlock': {
        const body = secret(String(el.getAttribute('id')))
        return body ? `> 🔒 **Segredo**\n${body.split('\n').map((l) => `> ${l}`).join('\n')}` : ''
      }
      case 'table': {
        const rows = kids().map((r) => r.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement).map((cell) => blocks(cell).replace(/\n+/g, ' ').replace(/\|/g, '\\|')))
        if (!rows.length) return ''
        return [`| ${rows[0]!.join(' | ')} |`, `| ${rows[0]!.map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n')
      }
      default: return blocks(el, indent)
    }
  }
  const blocks = (n: Y.XmlFragment | Y.XmlElement, indent = '') => n.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement).map((c) => block(c, indent)).filter((s) => s !== '').join('\n\n')
  return blocks(frag) + '\n'
}

