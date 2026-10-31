// Schema do banco (SDD §3). Tabelas de auth seguem o formato do Better Auth.
import { sql } from 'drizzle-orm'
import { boolean, check, customType, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID())
const createdAt = () => timestamp('created_at').notNull().defaultNow()
const updatedAt = () => timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date())
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

// --- Auth (Better Auth) ---
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// --- Campanha ---
export const role = pgEnum('role', ['gm', 'player', 'observer'])

export const campaign = pgTable('campaign', {
  id: id(),
  name: text('name').notNull(),
  coverAssetId: text('cover_asset_id'),
  ownerId: text('owner_id').notNull().references(() => user.id),
  inviteCode: text('invite_code').notNull().unique(),
  createdAt: createdAt(),
})

export const membership = pgTable('membership', {
  campaignId: text('campaign_id').notNull().references(() => campaign.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: role('role').notNull().default('player'),
  diceColor: text('dice_color').notNull().default('#c9a24a'),
  dice3d: boolean('dice_3d').notNull().default(true),
  // Última vez que este membro esteve na mesa; preenchido = existe foto dele em /c/[id]/snapshot.
  lastSeenAt: timestamp('last_seen_at'),
}, (t) => [primaryKey({ columns: [t.campaignId, t.userId] })])

// Pastas da biblioteca (barra de baixo da mesa): cada categoria tem sua árvore.
export const libraryCategory = pgEnum('library_category', ['maps', 'props', 'characters', 'creatures', 'attachments', 'notes', 'audio'])
export const libraryFolder = pgTable('library_folder', {
  id: id(),
  campaignId: text('campaign_id').notNull().references(() => campaign.id, { onDelete: 'cascade' }),
  category: libraryCategory('category').notNull(),
  // Preenchido = pasta pessoal de notas: só o dono vê e mexe. Não tem relação com a árvore da wiki.
  ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  sortOrder: real('sort_order').notNull().default(0),
}, (t) => [index().on(t.campaignId, t.category)])

export const asset = pgTable('asset', {
  id: id(),
  // Null = som padrão, vindo da pasta padroes/ do MinIO: vale para todas as campanhas.
  campaignId: text('campaign_id').references(() => campaign.id, { onDelete: 'cascade' }),
  // Item da biblioteca (objeto que vira token, anexo que abre em janela, ou música); null = só usado por outra coisa.
  library: text('library', { enum: ['prop', 'attachment', 'audio'] }),
  folderId: text('folder_id'),
  kind: text('kind', { enum: ['image', 'pdf', 'map', 'audio'] }).notNull(),
  name: text('name').notNull().default(''),
  mime: text('mime').notNull(),
  storageKey: text('storage_key').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  // Segundos, só em áudio: é com ela que cada cliente acha a posição da playlist.
  duration: real('duration'),
  // Onde o som aparece na mesa de som: música por estado, atmosfera ou grupo de efeitos.
  audioGroup: text('audio_group', { enum: ['exploration', 'combat', 'victory', 'ambient', 'action', 'impacts', 'people', 'magic', 'weapons', 'objects', 'monsters'] }),
  createdAt: createdAt(),
})

// --- Wiki ---
export const pageVisibility = pgEnum('page_visibility', ['hidden', 'visible', 'editable'])

export const page = pgTable('page', {
  id: id(),
  campaignId: text('campaign_id').notNull().references(() => campaign.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  // Preenchido = nota pessoal: só o dono vê, nem o mestre. A visibilidade não vale para ela.
  ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['text', 'map', 'timeline', 'board', 'folder'] }).notNull().default('text'),
  title: text('title').notNull(),
  icon: text('icon'),
  color: text('color'),
  sortOrder: real('sort_order').notNull().default(0),
  visibility: pageVisibility('visibility').notNull().default('hidden'),
  isTemplate: boolean('is_template').notNull().default(false),
  // O mestre indicou esta página para o painel de Notas da mesa.
  inNotes: boolean('in_notes').notNull().default(false),
  // Texto puro do documento Yjs, mantido pelo realtime para a busca (W9).
  searchText: text('search_text').notNull().default(''),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index().on(t.campaignId, t.parentId)])

// Em qual pasta pessoal cada um guardou uma nota: a mesma página da wiki pode estar em pastas diferentes para pessoas diferentes.
export const notePlacement = pgTable('note_placement', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  pageId: text('page_id').notNull().references(() => page.id, { onDelete: 'cascade' }),
  folderId: text('folder_id'),
}, (t) => [primaryKey({ columns: [t.userId, t.pageId] })])

// Links [[ ]] extraídos do documento, para backlinks (W5).
export const pageLink = pgTable('page_link', {
  fromId: text('from_id').notNull().references(() => page.id, { onDelete: 'cascade' }),
  toId: text('to_id').notNull().references(() => page.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.fromId, t.toId] }), index().on(t.toId)])

export const timelineEvent = pgTable('timeline_event', {
  id: id(),
  pageId: text('page_id').notNull().references(() => page.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  sortKey: real('sort_key').notNull().default(0),
  title: text('title').notNull(),
  linkPageId: text('link_page_id').references(() => page.id, { onDelete: 'set null' }),
})

// Quadro (W13–W18): elementos do Excalidraw por id, servidor autoritativo para filtrar cartões de páginas ocultas.
export const board = pgTable('board', {
  pageId: text('page_id').primaryKey().references(() => page.id, { onDelete: 'cascade' }),
  elements: jsonb('elements').$type<Record<string, unknown>>().notNull().default({}),
  // Imagens do quadro: só a URL do asset, nunca o arquivo em base64.
  files: jsonb('files').$type<Record<string, unknown>>().notNull().default({}),
})

export const secretBlock = pgTable('secret_block', {
  id: id(),
  pageId: text('page_id').notNull().references(() => page.id, { onDelete: 'cascade' }),
  visibleTo: text('visible_to').array().notNull().default(sql`'{}'`),
  searchText: text('search_text').notNull().default(''),
})

// Estado binário dos documentos Yjs (páginas, blocos secretos, quadros), salvo pelo Hocuspocus.
export const yDoc = pgTable('y_doc', {
  name: text('name').primaryKey(),
  state: bytea('state').notNull(),
  updatedAt: updatedAt(),
})

export const worldMap = pgTable('world_map', {
  id: id(),
  pageId: text('page_id').notNull().references(() => page.id, { onDelete: 'cascade' }),
  assetId: text('asset_id').notNull().references(() => asset.id),
})

// --- Fichas ---
export const sheetTemplate = pgTable('sheet_template', {
  id: id(),
  campaignId: text('campaign_id').notNull().references(() => campaign.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  pdfAssetId: text('pdf_asset_id').notNull().references(() => asset.id),
  fields: jsonb('fields').notNull().default([]),
  // Molde pronto do app (ficha D&D 5e de personagem ou de criatura); null = PDF do mestre.
  builtin: text('builtin', { enum: ['dnd5e-character', 'dnd5e-creature'] }),
  updatedAt: updatedAt(),
})

export const actor = pgTable('actor', {
  id: id(),
  campaignId: text('campaign_id').notNull().references(() => campaign.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  avatarAssetId: text('avatar_asset_id'),
  ownerIds: text('owner_ids').array().notNull().default(sql`'{}'`),
  kind: text('kind', { enum: ['character', 'creature'] }).notNull().default('character'),
  folderId: text('folder_id'),
})

// Um ator pode ter várias fichas (F12); alias é como as fórmulas a referenciam (@companheiro.forca).
export const sheet = pgTable('sheet', {
  id: id(),
  templateId: text('template_id').notNull().references(() => sheetTemplate.id),
  actorId: text('actor_id').references(() => actor.id, { onDelete: 'cascade' }),
  alias: text('alias'),
  ownerIds: text('owner_ids').array().notNull().default(sql`'{}'`),
  values: jsonb('values').notNull().default({}),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.actorId, t.alias)])

// Anotação livre sobre a ficha, por usuário (F14).
export const sheetNote = pgTable('sheet_note', {
  sheetId: text('sheet_id').notNull().references(() => sheet.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  data: jsonb('data').notNull().default({ strokes: [], texts: [] }),
}, (t) => [primaryKey({ columns: [t.sheetId, t.userId] })])

// --- Tabuleiro ---
export const scene = pgTable('scene', {
  id: id(),
  campaignId: text('campaign_id').notNull().references(() => campaign.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  assetId: text('asset_id').references(() => asset.id),
  grid: jsonb('grid').notNull().default({ size: 70, offsetX: 0, offsetY: 0, color: '#ffffff33', unit: 1.5, diagonal: '1:1' }),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  active: boolean('active').notNull().default(false),
  // Modo masmorra: escuridão + visão + névoa (L3–L5).
  dungeon: boolean('dungeon').notNull().default(false),
  // Área que o mestre revelou à mão (L5): vale para todos os jogadores, inclusive quem entrar depois.
  reveal: bytea('reveal'),
  combat: jsonb('combat'),
  // Mixagem da mesa de som (SoundMix no core). Quem toca é só a cena ativa.
  music: jsonb('music').notNull().default({}),
  sortOrder: real('sort_order').notNull().default(0),
  folderId: text('folder_id'),
}, (t) => [uniqueIndex('one_active_scene').on(t.campaignId).where(sql`${t.active}`)])

export const token = pgTable('token', {
  id: id(),
  sceneId: text('scene_id').notNull().references(() => scene.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').references(() => actor.id, { onDelete: 'set null' }),
  name: text('name').notNull().default(''),
  imageAssetId: text('image_asset_id'),
  x: real('x').notNull(),
  y: real('y').notNull(),
  size: integer('size').notNull().default(1),
  bars: jsonb('bars').notNull().default([]),
  conditions: text('conditions').array().notNull().default(sql`'{}'`),
  layer: text('layer', { enum: ['tokens', 'gm'] }).notNull().default('tokens'),
  vision: jsonb('vision'),
  light: jsonb('light'),
})

export const wall = pgTable('wall', {
  id: id(),
  sceneId: text('scene_id').notNull().references(() => scene.id, { onDelete: 'cascade' }),
  points: jsonb('points').$type<number[]>().notNull(),
  kind: text('kind', { enum: ['wall', 'door', 'window'] }).notNull().default('wall'),
  state: text('state', { enum: ['open', 'closed', 'locked'] }),
})

export const light = pgTable('light', {
  id: id(),
  sceneId: text('scene_id').notNull().references(() => scene.id, { onDelete: 'cascade' }),
  x: real('x').notNull(),
  y: real('y').notNull(),
  bright: real('bright').notNull(),
  dim: real('dim').notNull(),
  color: text('color'),
})

export const drawing = pgTable('drawing', {
  id: id(),
  sceneId: text('scene_id').notNull().references(() => scene.id, { onDelete: 'cascade' }),
  points: jsonb('points').$type<number[]>().notNull(),
  color: text('color').notNull(),
  width: real('width').notNull(),
  layer: text('layer', { enum: ['tokens', 'gm'] }).notNull().default('tokens'),
})

// Névoa já explorada por jogador numa cena: um bit por célula de FOG_CELL px (L5).
export const fog = pgTable('fog', {
  sceneId: text('scene_id').notNull().references(() => scene.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  bits: bytea('bits').notNull(),
}, (t) => [primaryKey({ columns: [t.sceneId, t.userId] })])

// Pin serve mapa da wiki (W8) ou cena (P1–P8); coordenadas normalizadas 0–1.
export const pin = pgTable('pin', {
  id: id(),
  mapId: text('map_id').references(() => worldMap.id, { onDelete: 'cascade' }),
  sceneId: text('scene_id').references(() => scene.id, { onDelete: 'cascade' }),
  x: real('x').notNull(),
  y: real('y').notNull(),
  icon: text('icon'),
  imageAssetId: text('image_asset_id'),
  label: text('label'),
  note: jsonb('note'),
  linkPageId: text('link_page_id').references(() => page.id, { onDelete: 'set null' }),
  visibility: text('visibility', { enum: ['all', 'gm', 'some'] }).notNull().default('gm'),
  visibleTo: text('visible_to').array().notNull().default(sql`'{}'`),
  hiddenByFog: boolean('hidden_by_fog').notNull().default(false),
}, (t) => [check('pin_one_parent', sql`(${t.mapId} is null) <> (${t.sceneId} is null)`)])

// --- Chat ---
export const chatMessage = pgTable('chat_message', {
  id: id(),
  campaignId: text('campaign_id').notNull().references(() => campaign.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => user.id),
  actorId: text('actor_id').references(() => actor.id, { onDelete: 'set null' }),
  text: text('text'),
  roll: jsonb('roll'),
  visibility: text('visibility', { enum: ['public', 'hidden', 'private'] }).notNull().default('public'),
  // Sussurro (/w): destinatários além do autor e do mestre.
  toUserIds: text('to_user_ids').array().notNull().default(sql`'{}'`),
  createdAt: createdAt(),
}, (t) => [index().on(t.campaignId, t.createdAt)])

// Botões de rolagem salvos por jogador (D5).
export const macro = pgTable('macro', {
  id: id(),
  campaignId: text('campaign_id').notNull().references(() => campaign.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  formula: text('formula').notNull(),
})
