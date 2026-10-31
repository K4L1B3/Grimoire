// Wiki (SDD §4): texto colaborativo com Yjs/Hocuspocus; árvore, busca, segredos, linha do tempo, mapas e quadros pelo Socket.IO.
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import { z } from 'zod'
import { and, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { Hocuspocus } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import { db, asset, board, membership, page, pageLink, pin, secretBlock, timelineEvent, worldMap, yDoc } from '@grimorio/db'
import { auth } from '@grimorio/db/auth'
import { can, pinVisible, type Member } from '@grimorio/core'
import { handler, refreshMember, type IO, type S } from './ctx.ts'
import { pinView } from './board.ts'

type PageRow = typeof page.$inferSelect
const uuid = z.string().uuid()

async function memberOf(campaignId: string, userId: string): Promise<Member | null> {
  const [m] = await db.select({ role: membership.role }).from(membership).where(and(eq(membership.campaignId, campaignId), eq(membership.userId, userId)))
  return m ? { userId, role: m.role } : null
}

// --- Hocuspocus: cada documento passa pelo can() antes de abrir; quem só vê recebe somente leitura. ---
export const hocus = new Hocuspocus({
  quiet: true,
  debounce: 1500,
  extensions: [
    new Database({
      fetch: async ({ documentName }) => (await db.select({ state: yDoc.state }).from(yDoc).where(eq(yDoc.name, documentName)))[0]?.state ?? null,
      store: async ({ documentName, state }) => {
        await db.insert(yDoc).values({ name: documentName, state: Buffer.from(state) }).onConflictDoUpdate({ target: yDoc.name, set: { state: Buffer.from(state) } })
      },
    }),
  ],
  async onAuthenticate({ requestHeaders, documentName, connectionConfig }) {
    const session = await auth.api.getSession({ headers: requestHeaders })
    const a = session && (await access(documentName, session.user.id))
    if (!session || !a?.view) throw new Error('forbidden')
    connectionConfig.readOnly = !a.edit
    return { userId: session.user.id }
  },
  // Mantém texto puro e links atualizados para busca (W9) e backlinks (W5).
  async onStoreDocument({ documentName, document }) {
    const [kind, id] = documentName.split(':')
    const { text, links } = extract(document.getXmlFragment('default'))
    if (kind === 'page') {
      await db.transaction(async (tx) => {
        await tx.update(page).set({ searchText: text.slice(0, 200_000) }).where(eq(page.id, id!))
        await tx.delete(pageLink).where(eq(pageLink.fromId, id!))
        const targets = links.size ? (await tx.select({ id: page.id }).from(page).where(inArray(page.id, [...links]))).map((r) => r.id) : []
        if (targets.length) await tx.insert(pageLink).values(targets.map((toId) => ({ fromId: id!, toId }))).onConflictDoNothing()
      })
    } else if (kind === 'secret') {
      await db.update(secretBlock).set({ searchText: text.slice(0, 100_000) }).where(eq(secretBlock.id, id!))
    }
  },
})

// Quem pode ver e editar um documento: página pela visibilidade; segredo (ADR-4) só para quem está marcado, e só o mestre edita.
async function access(documentName: string, userId: string) {
  const [kind, id] = documentName.split(':')
  if (kind === 'page') {
    const [p] = await db.select().from(page).where(eq(page.id, id!))
    const m = p && (await memberOf(p.campaignId, userId))
    return p && m && can(m, 'page.view', p) ? { view: true, edit: can(m, 'page.edit', p) } : null
  }
  if (kind === 'secret') {
    const [row] = await db.select({ s: secretBlock, p: page }).from(secretBlock).innerJoin(page, eq(page.id, secretBlock.pageId)).where(eq(secretBlock.id, id!))
    const m = row && (await memberOf(row.p.campaignId, userId))
    return row && m && can(m, 'page.view', row.p) && can(m, 'secret.view', row.s) ? { view: true, edit: m.role === 'gm' } : null
  }
  return null
}

// Regra mudou com gente conectada: só quem perdeu acesso cai; o resto só passa a ler ou editar conforme a regra nova.
export async function recheck(documentName: string) {
  const doc = hocus.documents.get(documentName)
  if (!doc) return
  for (const conn of doc.getConnections()) {
    const a = await access(documentName, (conn.context as { userId: string }).userId)
    if (!a) conn.close()
    else conn.readOnly = !a.edit
  }
}

// Texto e links [[ ]] de um documento TipTap/Yjs, sem precisar do schema do editor.
export function extract(frag: Y.XmlFragment | Y.XmlElement) {
  const links = new Set<string>()
  const parts: string[] = []
  const walk = (n: Y.XmlElement | Y.XmlText | Y.XmlFragment) => {
    if (n instanceof Y.XmlText) return void parts.push(n.toString().replace(/<[^>]+>/g, ''))
    if (n instanceof Y.XmlElement && n.nodeName === 'pageLink') {
      const to = n.getAttribute('id')
      if (to) links.add(String(to))
    }
    for (const c of n.toArray()) walk(c as Y.XmlElement)
    if (n instanceof Y.XmlElement) parts.push('\n')
  }
  walk(frag)
  return { text: parts.join('').replace(/\n{3,}/g, '\n\n').trim(), links }
}

const wss = new WebSocketServer({ noServer: true })
export function handleCollabUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  wss.handleUpgrade(req, socket, head, (ws) => {
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
    const client = hocus.handleConnection(ws, new Request(`http://localhost${req.url}`, { headers }))
    ws.on('message', (data: Buffer) => client.handleMessage(new Uint8Array(data)))
    ws.on('close', (code, reason) => client.handleClose({ code, reason: reason.toString() } as CloseEvent))
  })
}

// --- Socket.IO: árvore, busca, segredos, linha do tempo, mapas e quadros ---
export function registerWiki(io: IO, s: S) {
  const { campaignId } = s.data
  const gm = async () => {
    const m = await refreshMember(s)
    if (!m || m.role !== 'gm') throw new Error('Só o mestre pode fazer isso')
    return m
  }
  // Nota pessoal de outra pessoa não existe para ninguém, nem para o mestre.
  const ownPage = async (id: string) => {
    const [p] = await db.select().from(page).where(and(eq(page.id, id), eq(page.campaignId, campaignId)))
    if (!p || (p.ownerId && p.ownerId !== s.data.member.userId)) throw new Error('Página não encontrada')
    return p
  }
  // Mesmo filtro em SQL, para listas: páginas da wiki que a pessoa enxerga; a árvore leva também as próprias notas.
  const inWiki = (m: Member) => and(isNull(page.ownerId), m.role === 'gm' ? undefined : ne(page.visibility, 'hidden'))
  const viewable = async (id: string) => {
    const m = await refreshMember(s)
    const p = await ownPage(id)
    if (!m || !can(m, 'page.view', p)) throw new Error('Página não encontrada')
    return { m, p }
  }
  const editable = async (id: string) => {
    const { m, p } = await viewable(id)
    if (!can(m, 'page.edit', p)) throw new Error('Você não pode editar esta página')
    return { m, p }
  }
  const changed = () => io.to(`c:${campaignId}`).emit('wiki:changed')

  s.on('wiki:tree', handler(z.object({}).passthrough().parse, async () => {
    const m = await refreshMember(s)
    if (!m) return { pages: [] }
    const rows = await db.select({ id: page.id, parentId: page.parentId, ownerId: page.ownerId, title: page.title, icon: page.icon, color: page.color, sortOrder: page.sortOrder, visibility: page.visibility, kind: page.kind, isTemplate: page.isTemplate, inNotes: page.inNotes })
      .from(page).where(and(eq(page.campaignId, campaignId), or(eq(page.ownerId, m.userId), inWiki(m)))).orderBy(page.sortOrder)
    return { pages: rows, role: m.role }
  }))

  s.on('page:create', handler(z.object({ parentId: z.string().nullish(), title: z.string().trim().min(1).max(120), kind: z.enum(['text', 'map', 'timeline', 'board', 'folder']).default('text'), fromTemplate: z.string().nullish(), inNotes: z.boolean().default(false) }).parse, async ({ parentId, title, kind, fromTemplate, inNotes }) => {
    const m = await refreshMember(s)
    if (!m) throw new Error('Só o mestre pode fazer isso')
    const note = m.role !== 'gm'
    if (note && (kind !== 'text' || fromTemplate)) throw new Error('Só o mestre pode fazer isso')
    // ponytail: nota pessoal é plana (sem pai), para apagar uma página da wiki nunca levar a nota de alguém junto.
    if (parentId && !note) await ownPage(parentId)
    const id = crypto.randomUUID()
    // Pasta criada para Notas é da mesa: nasce visível (as páginas dentro seguem com a visibilidade delas).
    await db.insert(page).values({ id, campaignId, parentId: note ? null : parentId ?? null, ownerId: note ? m.userId : null, title, kind, inNotes, visibility: kind === 'folder' && inNotes ? 'visible' : undefined, sortOrder: Date.now() })
    // Template criado pelo mestre (W10): copia o documento da página-modelo.
    if (fromTemplate) {
      const tpl = await ownPage(fromTemplate)
      const doc = hocus.documents.get(`page:${tpl.id}`)
      const state = doc ? Y.encodeStateAsUpdate(doc) : (await db.select({ state: yDoc.state }).from(yDoc).where(eq(yDoc.name, `page:${tpl.id}`)))[0]?.state
      if (state) await db.insert(yDoc).values({ name: `page:${id}`, state: Buffer.from(state) })
    }
    changed()
    return { id }
  }))

  s.on('page:update', handler(z.object({ id: uuid, patch: z.object({ title: z.string().trim().min(1).max(120), icon: z.string().max(60).nullable(), color: z.string().max(20).nullable(), visibility: z.enum(['hidden', 'visible', 'editable']), isTemplate: z.boolean(), inNotes: z.boolean() }).partial() }).parse, async ({ id, patch }) => {
    const p = await ownPage(id)
    if (!p.ownerId) await gm()
    if (p.kind === 'folder' && patch.inNotes && !p.inNotes) patch.visibility ??= 'visible'
    await db.update(page).set(patch).where(eq(page.id, id))
    // Mudou quem vê: derruba as conexões abertas para cada um reautenticar com a regra nova.
    if (patch.visibility) {
      await recheck(`page:${id}`)
      for (const sb of await db.select({ id: secretBlock.id }).from(secretBlock).where(eq(secretBlock.pageId, id))) await recheck(`secret:${sb.id}`)
      io.to(`board:${id}`).emit('board:reload')
    }
    changed()
  }))

  s.on('page:move', handler(z.object({ id: uuid, parentId: z.string().nullable(), sortOrder: z.number() }).parse, async ({ id, parentId, sortOrder }) => {
    await gm()
    await ownPage(id)
    // Não deixa mover uma página para dentro dela mesma.
    for (let p = parentId; p; p = (await ownPage(p)).parentId) if (p === id) throw new Error('Não dá para mover uma página para dentro dela')
    await db.update(page).set({ parentId, sortOrder }).where(eq(page.id, id))
    changed()
  }))

  // "Mostrar aos jogadores": revela a página (fica revelada até o mestre ocultar) e abre uma janela na tela de todos.
  s.on('page:show', handler(z.object({ id: uuid }).parse, async ({ id }) => {
    await gm()
    const p = await ownPage(id)
    if (p.ownerId) throw new Error('Nota pessoal não pode ser mostrada')
    if (p.visibility === 'hidden') await db.update(page).set({ visibility: 'visible' }).where(eq(page.id, id))
    changed()
    s.to(`c:${campaignId}`).emit('page:shown', { id, title: p.title })
  }))

  s.on('page:delete', handler(z.object({ id: uuid }).parse, async ({ id }) => {
    const p = await ownPage(id)
    if (!p.ownerId) await gm()
    // Pasta só agrupa: como nas pastas da biblioteca, o que está dentro sobe um nível (e continua em Notas, se a pasta estava).
    if (p.kind === 'folder') {
      await db.transaction(async (tx) => {
        await tx.update(page).set(p.inNotes ? { parentId: p.parentId, inNotes: true } : { parentId: p.parentId }).where(and(eq(page.campaignId, campaignId), eq(page.parentId, id)))
        await tx.delete(page).where(eq(page.id, id))
      })
      changed()
      return
    }
    const all = await db.select({ id: page.id, parentId: page.parentId }).from(page).where(eq(page.campaignId, campaignId))
    const gone = new Set([id])
    for (let grew = true; grew; ) {
      grew = false
      for (const p of all) if (p.parentId && gone.has(p.parentId) && !gone.has(p.id)) (gone.add(p.id), (grew = true))
    }
    const ids = [...gone]
    await db.transaction(async (tx) => {
      await tx.delete(yDoc).where(inArray(yDoc.name, ids.map((x) => `page:${x}`)))
      await tx.delete(page).where(inArray(page.id, ids))
    })
    for (const x of ids) hocus.closeConnections(`page:${x}`)
    changed()
  }))

  // Busca por título e conteúdo (W9), respeitando permissões: segredo só entra para quem pode ver. Nota pessoal não é da wiki.
  s.on('wiki:search', handler(z.object({ q: z.string().trim().min(1).max(100) }).parse, async ({ q }) => {
    const m = await refreshMember(s)
    if (!m) return []
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
    const pages = await db.select({ id: page.id, title: page.title, text: page.searchText }).from(page)
      .where(and(eq(page.campaignId, campaignId), inWiki(m), or(ilike(page.title, like), ilike(page.searchText, like)))).limit(30)
    const secrets = await db.select({ id: page.id, title: page.title, text: secretBlock.searchText, visibleTo: secretBlock.visibleTo }).from(secretBlock).innerJoin(page, eq(page.id, secretBlock.pageId))
      .where(and(eq(page.campaignId, campaignId), inWiki(m), ilike(secretBlock.searchText, like), m.role === 'gm' ? undefined : sql`${m.userId} = any(${secretBlock.visibleTo})`)).limit(20)
    const snippet = (t: string) => {
      const i = t.toLowerCase().indexOf(q.toLowerCase())
      return i < 0 ? '' : `${i > 40 ? '…' : ''}${t.slice(Math.max(0, i - 40), i + q.length + 60)}`
    }
    return [
      ...pages.map((p) => ({ id: p.id, title: p.title, snippet: snippet(p.text), secret: false })),
      ...secrets.filter((x) => m.role === 'gm' || x.visibleTo.includes(m.userId)).map((p) => ({ id: p.id, title: p.title, snippet: snippet(p.text), secret: true })),
    ]
  }))

  s.on('wiki:backlinks', handler(z.object({ id: uuid }).parse, async ({ id }) => {
    const { m, p } = await viewable(id)
    const rows = await db.select({ id: page.id, title: page.title, visibility: page.visibility, ownerId: page.ownerId }).from(pageLink).innerJoin(page, eq(page.id, pageLink.fromId)).where(eq(pageLink.toId, id))
    // Nota pessoal que cita uma página da wiki não aparece no rodapé dela.
    return rows.filter((r) => can(m, 'page.view', r) && (!r.ownerId || p.ownerId)).map(({ id, title }) => ({ id, title }))
  }))

  // --- Blocos secretos (W6) ---
  s.on('secret:create', handler(z.object({ pageId: uuid }).parse, async ({ pageId }) => {
    await gm()
    await ownPage(pageId)
    const [sb] = await db.insert(secretBlock).values({ pageId }).returning({ id: secretBlock.id })
    return { id: sb!.id }
  }))

  s.on('secret:get', handler(z.object({ id: uuid }).parse, async ({ id }) => {
    const m = await refreshMember(s)
    const [row] = await db.select({ s: secretBlock, p: page }).from(secretBlock).innerJoin(page, eq(page.id, secretBlock.pageId)).where(and(eq(secretBlock.id, id), eq(page.campaignId, campaignId)))
    if (!m || !row || !can(m, 'page.view', row.p) || !can(m, 'secret.view', row.s)) return { canView: false }
    return { canView: true, canEdit: m.role === 'gm', visibleTo: m.role === 'gm' ? row.s.visibleTo : [] }
  }))

  s.on('secret:share', handler(z.object({ id: uuid, visibleTo: z.array(z.string()).max(50) }).parse, async ({ id, visibleTo }) => {
    await gm()
    const [row] = await db.select({ id: secretBlock.id }).from(secretBlock).innerJoin(page, eq(page.id, secretBlock.pageId)).where(and(eq(secretBlock.id, id), eq(page.campaignId, campaignId)))
    if (!row) throw new Error('Segredo não encontrado')
    await db.update(secretBlock).set({ visibleTo }).where(eq(secretBlock.id, id))
    await recheck(`secret:${id}`)
    io.to(`c:${campaignId}`).emit('secret:changed', { id })
  }))

  // --- Linha do tempo (W11) ---
  s.on('timeline:list', handler(z.object({ pageId: uuid }).parse, async ({ pageId }) => {
    await viewable(pageId)
    return db.select().from(timelineEvent).where(eq(timelineEvent.pageId, pageId)).orderBy(timelineEvent.sortKey, timelineEvent.date)
  }))
  s.on('timeline:upsert', handler(z.object({ pageId: uuid, id: z.string().uuid().optional(), date: z.string().trim().min(1).max(60), sortKey: z.number(), title: z.string().trim().min(1).max(200), linkPageId: z.string().nullish() }).parse, async ({ id, ...ev }) => {
    await editable(ev.pageId)
    if (id) await db.update(timelineEvent).set(ev).where(and(eq(timelineEvent.id, id), eq(timelineEvent.pageId, ev.pageId)))
    else await db.insert(timelineEvent).values(ev)
    io.to(`c:${campaignId}`).emit('timeline:changed', { pageId: ev.pageId })
  }))
  s.on('timeline:delete', handler(z.object({ pageId: uuid, id: uuid }).parse, async ({ pageId, id }) => {
    await editable(pageId)
    await db.delete(timelineEvent).where(and(eq(timelineEvent.id, id), eq(timelineEvent.pageId, pageId)))
    io.to(`c:${campaignId}`).emit('timeline:changed', { pageId })
  }))

  // --- Mapa com pins (W8): mesmos pins da cena ---
  s.on('map:join', handler(z.object({ pageId: uuid }).parse, async ({ pageId }) => {
    const { m } = await viewable(pageId)
    const [mp] = await db.select({ id: worldMap.id, assetId: worldMap.assetId, width: asset.width, height: asset.height }).from(worldMap).innerJoin(asset, eq(asset.id, worldMap.assetId)).where(eq(worldMap.pageId, pageId))
    if (!mp) return { map: null, pins: [] }
    for (const r of s.rooms) if (r.startsWith('map:')) s.leave(r)
    s.join(`map:${mp.id}`)
    const pins = await db.select().from(pin).where(eq(pin.mapId, mp.id))
    return { map: mp, pins: pins.filter((p) => pinVisible(p, m)).map((p) => pinView(p, m)) }
  }))
  s.on('map:set', handler(z.object({ pageId: uuid, assetId: uuid }).parse, async ({ pageId, assetId }) => {
    await gm()
    await ownPage(pageId)
    const [a] = await db.select({ id: asset.id }).from(asset).where(and(eq(asset.id, assetId), eq(asset.campaignId, campaignId)))
    if (!a) throw new Error('Imagem não encontrada')
    const [cur] = await db.select({ id: worldMap.id }).from(worldMap).where(eq(worldMap.pageId, pageId))
    if (cur) await db.update(worldMap).set({ assetId }).where(eq(worldMap.id, cur.id))
    else await db.insert(worldMap).values({ pageId, assetId })
    io.to(`c:${campaignId}`).emit('map:changed', { pageId })
  }))

  // --- Quadro (W13–W18): elementos do Excalidraw, último a editar cada elemento vence (por versão) ---
  const boardView = async (pageId: string, m: Member) => {
    const [b] = await db.select({ elements: board.elements }).from(board).where(eq(board.pageId, pageId))
    const els = Object.values(b?.elements ?? {}) as Record<string, unknown>[]
    if (m.role === 'gm') return els
    // W17: cartão de página que o jogador não pode ver vira "Página oculta", sem o título.
    const linked = [...new Set(els.map((e) => (e.customData as { pageId?: string } | undefined)?.pageId).filter((x): x is string => !!x))]
    const visible = new Set(linked.length ? (await db.select({ id: page.id, visibility: page.visibility, ownerId: page.ownerId }).from(page).where(inArray(page.id, linked))).filter((p) => can(m, 'page.view', p)).map((p) => p.id) : [])
    return els.map((e) => {
      const pid = (e.customData as { pageId?: string } | undefined)?.pageId
      if (!pid || visible.has(pid)) return e
      return { ...e, link: null, customData: { pageId: null, hidden: true }, ...(e.type === 'text' ? { text: 'Página oculta', originalText: 'Página oculta' } : {}) }
    })
  }
  s.on('board:join', handler(z.object({ pageId: uuid }).parse, async ({ pageId }) => {
    const { m, p } = await viewable(pageId)
    for (const r of s.rooms) if (r.startsWith('board:')) s.leave(r)
    s.join(`board:${pageId}`)
    const [b] = await db.select({ files: board.files }).from(board).where(eq(board.pageId, pageId))
    return { elements: await boardView(pageId, m), files: Object.values(b?.files ?? {}), canEdit: can(m, 'page.edit', p) }
  }))
  s.on('board:update', handler(z.object({ pageId: uuid, elements: z.array(z.object({ id: z.string().max(100), version: z.number() }).passthrough()).max(500) }).parse, async ({ pageId, elements }) => {
    const { m } = await editable(pageId)
    const accepted: Record<string, unknown>[] = []
    await db.transaction(async (tx) => {
      const [cur] = await tx.select({ elements: board.elements }).from(board).where(eq(board.pageId, pageId)).for('update')
      type El = { id: string; version: number; text?: string; originalText?: string; customData?: { pageId?: string | null; hidden?: boolean } }
      const all = { ...(cur?.elements ?? {}) } as Record<string, El>
      for (const e of elements as El[]) {
        const prev = all[e.id]
        if (prev && prev.version >= e.version) continue
        // Jogador mexendo num cartão de página oculta: o vínculo e o título originais ficam como estavam no servidor.
        const keep = m.role !== 'gm' && e.customData?.hidden && prev?.customData?.pageId
        const next = keep ? { ...e, customData: prev.customData, text: prev.text, originalText: prev.originalText } : e
        all[e.id] = next
        accepted.push(next)
      }
      if (cur) await tx.update(board).set({ elements: all }).where(eq(board.pageId, pageId))
      else await tx.insert(board).values({ pageId, elements: all })
    })
    if (!accepted.length) return
    for (const raw of await io.in(`board:${pageId}`).fetchSockets()) {
      if (raw.id === s.id) continue
      const o = raw as unknown as S
      raw.emit('board:elements', { pageId, elements: o.data.member.role === 'gm' ? accepted : (await boardView(pageId, o.data.member)).filter((e) => accepted.some((a) => a.id === e.id)) })
    }
  }))
  s.on('board:files', handler(z.object({ pageId: uuid, files: z.array(z.object({ id: z.string().max(100), mimeType: z.string().max(100), dataURL: z.string().regex(/^\/api\/assets\/[0-9a-f-]{36}$/), created: z.number() })).max(50) }).parse, async ({ pageId, files }) => {
    await editable(pageId)
    const add = Object.fromEntries(files.map((f) => [f.id, f]))
    await db.insert(board).values({ pageId, files: add }).onConflictDoUpdate({ target: board.pageId, set: { files: sql`${board.files} || ${JSON.stringify(add)}::jsonb` } })
    s.to(`board:${pageId}`).emit('board:files', { pageId, files })
  }))
  s.on('board:pointer', handler(z.object({ pageId: uuid, x: z.number(), y: z.number() }).parse, async ({ pageId, x, y }) => {
    s.to(`board:${pageId}`).emit('board:pointer', { userId: s.data.member.userId, name: s.data.userName, x, y })
  }))
}
