'use server'
// Biblioteca da mesa (barra de baixo, estilo Owlbear): pastas por categoria e os itens de cada uma.
import { and, arrayContains, asc, eq, inArray, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { db, actor, asset, libraryFolder, notePlacement, page, scene, sheet, sheetTemplate } from '@grimorio/db'
import { requireGm, requireMember } from '@/lib/session'
import { deleteFile } from '@/lib/storage'

export type Category = 'maps' | 'props' | 'characters' | 'creatures' | 'attachments' | 'notes' | 'audio'
const Cat = z.enum(['maps', 'props', 'characters', 'creatures', 'attachments', 'notes', 'audio'])
// Categorias que são arquivos soltos, e como cada uma se chama na coluna asset.library.
const LIBRARY = { props: 'prop', attachments: 'attachment', audio: 'audio' } as const
const isFile = (c: Category): c is keyof typeof LIBRARY => c in LIBRARY
export type Folder = { id: string; parentId: string | null; name: string }
export type Item = { id: string; name: string; folderId: string | null; image: string | null; sheetId?: string | null; active?: boolean; mime?: string; pc?: boolean }

export async function libraryList(campaignId: string, category: Category): Promise<{ folders: Folder[]; items: Item[] }> {
  const { member } = await requireMember(campaignId)
  const gm = member.role === 'gm'
  Cat.parse(category)
  const notes = category === 'notes'
  // Jogador só vê os próprios personagens e as próprias pastas de notas; o resto da biblioteca é do mestre.
  if (!gm && !notes && category !== 'characters') return { folders: [], items: [] }
  const folders = gm || notes ? await db.select({ id: libraryFolder.id, parentId: libraryFolder.parentId, name: libraryFolder.name }).from(libraryFolder).where(and(eq(libraryFolder.campaignId, campaignId), eq(libraryFolder.category, category), notes ? eq(libraryFolder.ownerId, member.userId) : undefined)).orderBy(asc(libraryFolder.name)) : []

  // As notas em si vêm da árvore ao vivo da wiki; daqui só sai em qual pasta a pessoa guardou cada uma.
  if (notes) {
    const rows = await db.select({ id: notePlacement.pageId, folderId: notePlacement.folderId }).from(notePlacement).innerJoin(page, eq(page.id, notePlacement.pageId)).where(and(eq(notePlacement.userId, member.userId), eq(page.campaignId, campaignId)))
    return { folders, items: rows.map((r) => ({ ...r, name: '', image: null })) }
  }
  if (category === 'maps') {
    const rows = await db.select({ id: scene.id, name: scene.name, image: scene.assetId, active: scene.active, folderId: scene.folderId }).from(scene).where(eq(scene.campaignId, campaignId)).orderBy(asc(scene.sortOrder))
    return { folders, items: rows }
  }
  if (isFile(category)) {
    const rows = await db.select({ id: asset.id, name: asset.name, folderId: asset.folderId, mime: asset.mime }).from(asset).where(and(eq(asset.campaignId, campaignId), eq(asset.library, LIBRARY[category]))).orderBy(asc(asset.name))
    return { folders, items: rows.map((r) => ({ ...r, image: r.mime.startsWith('image/') ? r.id : null })) }
  }
  const kind = category === 'characters' ? 'character' : 'creature'
  const actors = await db.select({ id: actor.id, name: actor.name, image: actor.avatarAssetId, folderId: actor.folderId, ownerIds: actor.ownerIds }).from(actor)
    .where(and(eq(actor.campaignId, campaignId), eq(actor.kind, kind), gm ? undefined : arrayContains(actor.ownerIds, [member.userId]))).orderBy(asc(actor.name))
  const sheets = actors.length ? await db.select({ id: sheet.id, actorId: sheet.actorId }).from(sheet).where(and(inArray(sheet.actorId, actors.map((a) => a.id)), isNull(sheet.alias))) : []
  return { folders, items: actors.map(({ ownerIds, ...a }) => ({ ...a, pc: ownerIds.length > 0, sheetId: sheets.find((s) => s.actorId === a.id)?.id ?? null })) }
}

// Fichas em PDF importadas na campanha (as antigas geradas pelo sistema ficam de fora).
export async function importedSheets(campaignId: string) {
  await requireMember(campaignId)
  return db.select({ id: sheetTemplate.id, name: sheetTemplate.name }).from(sheetTemplate).where(and(eq(sheetTemplate.campaignId, campaignId), isNull(sheetTemplate.builtin))).orderBy(asc(sheetTemplate.name))
}

// Pasta de notas é pessoal: cada um só mexe nas suas. As outras são do mestre.
async function folderOf(campaignId: string, id: string) {
  const { member } = await requireMember(campaignId)
  const [f] = await db.select().from(libraryFolder).where(and(eq(libraryFolder.id, id), eq(libraryFolder.campaignId, campaignId)))
  if (!f || (f.category === 'notes' ? f.ownerId !== member.userId : member.role !== 'gm')) throw new Error('Pasta não encontrada')
  return f
}

export async function createFolder(campaignId: string, category: Category, name: string, parentId: string | null) {
  const notes = Cat.parse(category) === 'notes'
  const { member } = await (notes ? requireMember : requireGm)(campaignId)
  if (parentId) await folderOf(campaignId, parentId)
  const [f] = await db.insert(libraryFolder).values({ campaignId, category, ownerId: notes ? member.userId : null, name: z.string().trim().min(1).max(60).parse(name), parentId }).returning({ id: libraryFolder.id })
  return f!
}

export async function renameFolder(campaignId: string, id: string, name: string) {
  await folderOf(campaignId, id)
  await db.update(libraryFolder).set({ name: z.string().trim().min(1).max(60).parse(name) }).where(and(eq(libraryFolder.id, id), eq(libraryFolder.campaignId, campaignId)))
}

// Apagar pasta não apaga nada dentro: subpastas e itens sobem um nível.
export async function deleteFolder(campaignId: string, id: string) {
  const f = await folderOf(campaignId, id)
  await db.transaction(async (tx) => {
    await tx.update(libraryFolder).set({ parentId: f.parentId }).where(eq(libraryFolder.parentId, id))
    for (const t of [scene, asset, actor] as const) await tx.update(t).set({ folderId: f.parentId }).where(and(eq(t.campaignId, campaignId), eq(t.folderId, id)))
    await tx.update(notePlacement).set({ folderId: f.parentId }).where(eq(notePlacement.folderId, id))
    await tx.delete(libraryFolder).where(eq(libraryFolder.id, id))
  })
}

const table = (c: Category) => (c === 'maps' ? scene : isFile(c) ? asset : actor)

// Guardar nota numa pasta não muda nada na wiki nem para os outros: vale só para quem guardou.
async function placeNote(campaignId: string, pageId: string, folderId: string | null) {
  const { member } = await requireMember(campaignId)
  if (folderId && (await folderOf(campaignId, folderId)).category !== 'notes') throw new Error('Pasta não encontrada')
  const [p] = await db.select({ ownerId: page.ownerId }).from(page).where(and(eq(page.id, pageId), eq(page.campaignId, campaignId)))
  if (!p || (p.ownerId && p.ownerId !== member.userId)) throw new Error('Nota não encontrada')
  await db.insert(notePlacement).values({ userId: member.userId, pageId, folderId }).onConflictDoUpdate({ target: [notePlacement.userId, notePlacement.pageId], set: { folderId } })
}

export async function moveItem(campaignId: string, category: Category, id: string, folderId: string | null) {
  if (category === 'notes') return placeNote(campaignId, id, folderId)
  await requireGm(campaignId)
  if (folderId) {
    const [f] = await db.select({ id: libraryFolder.id }).from(libraryFolder).where(and(eq(libraryFolder.id, folderId), eq(libraryFolder.campaignId, campaignId), eq(libraryFolder.category, Cat.parse(category))))
    if (!f) throw new Error('Pasta não encontrada')
  }
  const t = table(category)
  await db.update(t).set({ folderId }).where(and(eq(t.id, id), eq(t.campaignId, campaignId)))
}

export async function moveFolder(campaignId: string, id: string, parentId: string | null) {
  await folderOf(campaignId, id)
  for (let p = parentId; p; p = (await folderOf(campaignId, p)).parentId) if (p === id) throw new Error('Não dá para mover uma pasta para dentro dela')
  await db.update(libraryFolder).set({ parentId }).where(and(eq(libraryFolder.id, id), eq(libraryFolder.campaignId, campaignId)))
}

export async function renameItem(campaignId: string, category: Category, id: string, name: string) {
  await requireGm(campaignId)
  const n = z.string().trim().min(1).max(120).parse(name)
  const t = table(category)
  await db.update(t).set({ name: n }).where(and(eq(t.id, id), eq(t.campaignId, campaignId)))
}

// Item enviado pelo upload passa a ser um objeto (vira token), um anexo (abre em janela) ou uma música.
export async function addLibraryAsset(campaignId: string, assetId: string, category: keyof typeof LIBRARY, folderId: string | null) {
  await requireGm(campaignId)
  await db.update(asset).set({ library: LIBRARY[category], folderId }).where(and(eq(asset.id, assetId), eq(asset.campaignId, campaignId)))
}

// Tirar da biblioteca: o arquivo fica (pode estar em uso num token), só some da lista.
export async function removeLibraryAsset(campaignId: string, assetId: string) {
  await requireGm(campaignId)
  await db.update(asset).set({ library: null, folderId: null }).where(and(eq(asset.id, assetId), eq(asset.campaignId, campaignId)))
}

// Sons da campanha e os padrões, para a mesa de som do mestre.
export async function soundLibrary(campaignId: string) {
  await requireGm(campaignId)
  const rows = await db.select({ id: asset.id, name: asset.name, group: asset.audioGroup, duration: asset.duration, campaignId: asset.campaignId }).from(asset).where(and(or(eq(asset.campaignId, campaignId), isNull(asset.campaignId)), eq(asset.library, 'audio'))).orderBy(asc(asset.name))
  return rows.map(({ campaignId: owner, ...s }) => ({ ...s, isDefault: !owner }))
}

// Som pesa e só existe na biblioteca, então apagar libera o MinIO de verdade. As mixagens ignoram id que não existe mais.
export async function deleteAudio(campaignId: string, assetId: string) {
  await requireGm(campaignId)
  const [a] = await db.delete(asset).where(and(eq(asset.id, assetId), eq(asset.campaignId, campaignId), eq(asset.kind, 'audio'))).returning({ storageKey: asset.storageKey })
  if (a) await deleteFile(a.storageKey)
}
