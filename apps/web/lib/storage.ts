import 'server-only'
import path from 'node:path'
import os from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, paginateListObjectsV2, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { and, eq, isNull } from 'drizzle-orm'
import { db, asset } from '@grimorio/db'
import { ATMOSPHERE_GROUPS, EFFECT_GROUPS, SOUND_GROUPS, type SoundGroup } from '@grimorio/core'

// Arquivos vão para um S3 compatível (MinIO) quando S3_ENDPOINT está configurado; senão, disco local (SDD §8).
const UPLOAD_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR ?? 'data/uploads')
const BUCKET = process.env.S3_BUCKET ?? 'grimorio'
const s3 = process.env.S3_ENDPOINT
  ? new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: true, // MinIO responde em http://host:9000/bucket/chave
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_SECRET_KEY ?? '' },
    })
  : null

// Cria o bucket na primeira escrita, para o `docker compose up` não precisar de passo manual.
let bucketReady: Promise<void> | null = null
const ensureBucket = () => (bucketReady ??= s3!.send(new HeadBucketCommand({ Bucket: BUCKET })).then(() => {}, () => s3!.send(new CreateBucketCommand({ Bucket: BUCKET })).then(() => {})))

// Stream precisa do tamanho: o S3 não aceita corpo de tamanho desconhecido.
export async function putFile(key: string, data: Uint8Array | Readable, mime: string, size?: number) {
  if (s3) {
    await ensureBucket()
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: data, ContentType: mime, ContentLength: size }))
    return
  }
  await mkdir(path.dirname(path.join(UPLOAD_DIR, key)), { recursive: true })
  await writeFile(path.join(UPLOAD_DIR, key), data)
}

export async function getFile(key: string): Promise<Uint8Array> {
  if (s3) {
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
      return await res.Body!.transformToByteArray()
    } catch (e) {
      // Arquivos enviados antes de ligar o MinIO continuam no disco.
      if ((e as { name?: string }).name !== 'NoSuchKey' && (e as { name?: string }).name !== 'NoSuchBucket') throw e
    }
  }
  return new Uint8Array(await readFile(path.join(UPLOAD_DIR, key)))
}

// Trecho do arquivo como stream: música longa não passa inteira pela memória do servidor.
export async function readRange(key: string, start: number, end: number): Promise<ReadableStream> {
  if (s3) {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: `bytes=${start}-${end}` }))
    return res.Body!.transformToWebStream()
  }
  return Readable.toWeb(createReadStream(path.join(UPLOAD_DIR, key), { start, end })) as ReadableStream
}

export async function deleteFile(key: string) {
  if (s3) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
  else await unlink(path.join(UPLOAD_DIR, key)).catch(() => {})
}

const MAX_BYTES = 50 * 1024 * 1024
const MAX_AUDIO_BYTES = 1024 * 1024 * 1024
// Música ambiente não pede mais que isso, e cada jogador baixa o arquivo pela própria internet: 1 h fica em cerca de 58 MB.
const AUDIO_BITRATE = '128k'
// Só formatos de áudio: sem esta lista, um "áudio" que na verdade é uma playlist HLS faria o ffmpeg abrir arquivos do servidor.
const AUDIO_FORMATS = 'mp3,ogg,flac,wav,aiff,mov,matroska,aac'
// Volume-alvo em LUFS: arquivos de fontes diferentes chegam equilibrados, com o ambiente abaixo da música e o efeito acima.
const loudness = (group: SoundGroup) => ((EFFECT_GROUPS as readonly string[]).includes(group) ? -16 : (ATMOSPHERE_GROUPS as readonly string[]).includes(group) ? -24 : -19)
// Cada cliente decodifica o efeito inteiro na memória para ele sair na hora; música longa no lugar errado pesaria em todos.
const MAX_EFFECT_SECONDS = 60
const run = promisify(execFile)

// O ffmpeg conta em stdout até onde já escreveu; é isso que vira a barra de progresso.
function transcode(args: string[], onTime: (seconds: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15 * 60_000 })
    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      const time = /out_time_us=(\d+)/.exec(chunk.toString())
      if (time) onTime(Number(time[1]) / 1e6)
    })
    ffmpeg.on('error', reject)
    ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Não consegui ler esse áudio'))))
  })
}

// Grava o arquivo recebido numa pasta temporária; processAudio usa e apaga.
export async function receiveAudio(body: ReadableStream<Uint8Array>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'grimorio-audio-'))
  try {
    let received = 0
    await pipeline(Readable.fromWeb(body as never), async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        if ((received += chunk.length) > MAX_AUDIO_BYTES) throw new Error('Arquivo maior que 1 GB')
        yield chunk
      }
    }, createWriteStream(path.join(dir, 'in')))
    return dir
  } catch (e) {
    await rm(dir, { recursive: true, force: true })
    throw e
  }
}

type AudioTarget = { campaignId: string | null; name: string; group: SoundGroup; storageKey?: string }

// Todo áudio vira AAC com o índice no começo do arquivo (SDD §8): toca em qualquer navegador e pula para qualquer ponto sem baixar o resto.
export async function processAudio(dir: string, { campaignId, name, group, storageKey }: AudioTarget, onProgress: (fraction: number) => void = () => {}) {
  const input = path.join(dir, 'in'), output = path.join(dir, 'out.m4a')
  const guarded = ['-protocol_whitelist', 'file', '-format_whitelist', AUDIO_FORMATS]
  try {
    const probe = await run('ffprobe', ['-v', 'error', ...guarded, '-show_entries', 'format=duration', '-of', 'csv=p=0', input]).catch(() => { throw new Error('Não consegui ler esse áudio') })
    const total = Number(probe.stdout)
    if ((EFFECT_GROUPS as readonly string[]).includes(group) && !(total <= MAX_EFFECT_SECONDS)) throw new Error(`Efeito precisa ter até ${MAX_EFFECT_SECONDS} s`)
    await transcode(['-nostdin', '-v', 'error', '-nostats', '-progress', 'pipe:1', ...guarded, '-i', input, '-map', '0:a:0', '-map_metadata', '-1', '-af', `loudnorm=I=${loudness(group)}:TP=-1.5:LRA=11,aresample=44100`, '-ac', '2', '-c:a', 'aac', '-b:a', AUDIO_BITRATE, '-movflags', '+faststart', output],
      (seconds) => { if (total > 0) onProgress(Math.min(seconds / total, 1)) })
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', output])
    const duration = Number(stdout)
    if (!(duration > 0)) throw new Error('Não consegui ler esse áudio')
    const { size } = await stat(output)
    const id = crypto.randomUUID()
    const key = storageKey ?? `${campaignId}/${id}.m4a`
    await putFile(key, createReadStream(output), 'audio/mp4', size)
    const [row] = await db.insert(asset).values({ id, campaignId, kind: 'audio', library: 'audio', audioGroup: group, name, mime: 'audio/mp4', storageKey: key, size, duration }).returning()
    return row!
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// Sons padrão: basta soltar o arquivo na pasta do grupo no MinIO. Aqui ele é convertido uma vez e passa a valer para todas as campanhas;
// tirar da pasta tira do app. A chave leva o ETag: trocar o arquivo por outro de mesmo nome gera uma conversão nova.
const DEFAULTS = 'padroes'
const DEFAULT_FOLDERS: Record<SoundGroup, string> = {
  exploration: 'musica/exploracao', combat: 'musica/combate', victory: 'musica/vitoria',
  ambient: 'atmosferas/ambiente', action: 'atmosferas/acao',
  impacts: 'efeitos/impacto', people: 'efeitos/pessoas', magic: 'efeitos/magia', weapons: 'efeitos/armas', objects: 'efeitos/objetos', monsters: 'efeitos/monstros-e-criaturas',
}
const SYNC_EVERY = 60_000
let lastSync = 0, syncing: Promise<void> | null = null
// Arquivo que não é áudio (ou efeito longo) ficaria sendo reconvertido a cada sincronização.
const rejected = new Set<string>()

async function runSync() {
  await ensureBucket()
  const known = new Set((await db.select({ storageKey: asset.storageKey }).from(asset).where(isNull(asset.campaignId))).map((r) => r.storageKey))
  const present = new Set<string>()
  for (const group of SOUND_GROUPS) {
    const prefix = `${DEFAULTS}/${DEFAULT_FOLDERS[group]}/`
    await s3!.send(new PutObjectCommand({ Bucket: BUCKET, Key: prefix, Body: new Uint8Array(), ContentLength: 0 }))
    for await (const page of paginateListObjectsV2({ client: s3! }, { Bucket: BUCKET, Prefix: prefix })) {
      for (const object of page.Contents ?? []) {
        if (!object.Size) continue
        const storageKey = `${DEFAULTS}/convertidos/${group}/${object.ETag!.replaceAll('"', '')}.m4a`
        present.add(storageKey)
        if (known.has(storageKey) || rejected.has(storageKey)) continue
        try {
          const source = await s3!.send(new GetObjectCommand({ Bucket: BUCKET, Key: object.Key }))
          const name = path.basename(object.Key!).replace(/\.[^.]+$/, '').slice(0, 120)
          await processAudio(await receiveAudio(source.Body!.transformToWebStream()), { campaignId: null, name, group, storageKey })
          known.add(storageKey)
        } catch (e) {
          rejected.add(storageKey)
          console.error(`Som padrão ignorado (${object.Key}):`, (e as Error).message)
        }
      }
    }
  }
  for (const storageKey of known) {
    if (present.has(storageKey)) continue
    await db.delete(asset).where(and(eq(asset.storageKey, storageKey), isNull(asset.campaignId)))
    await deleteFile(storageKey)
  }
}

// Roda ao abrir a mesa de som, uma de cada vez; quem chega durante espera a mesma. Sem MinIO não há pasta para ler.
export function syncDefaultSounds() {
  if (!s3) return Promise.resolve()
  if (!syncing && Date.now() - lastSync > SYNC_EVERY) {
    lastSync = Date.now()
    syncing = runSync().catch((e) => console.error('Sons padrão:', e)).finally(() => { syncing = null })
  }
  return syncing ?? Promise.resolve()
}

export async function saveAsset(campaignId: string, file: File, kind: 'image' | 'pdf' | 'map') {
  if (file.size > MAX_BYTES) throw new Error('Arquivo maior que 50 MB')
  const input = Buffer.from(await file.arrayBuffer())
  let data = input, mime = file.type, width: number | null = null, height: number | null = null
  if (kind === 'pdf') {
    if (input.subarray(0, 5).toString() !== '%PDF-') throw new Error('Isso não é um PDF')
    mime = 'application/pdf'
  } else {
    // Imagens viram WebP no upload (SDD §8); a primeira carga da cena fica leve.
    const img = sharp(input, { limitInputPixels: 16384 * 16384 }).rotate()
    const out = await img.webp({ quality: 85 }).toBuffer({ resolveWithObject: true })
    ;[data, mime, width, height] = [out.data, 'image/webp', out.info.width, out.info.height]
  }
  const id = crypto.randomUUID()
  const storageKey = `${campaignId}/${id}${kind === 'pdf' ? '.pdf' : '.webp'}`
  await putFile(storageKey, data, mime)
  const [row] = await db.insert(asset).values({ id, campaignId, kind, name: file.name, mime, storageKey, size: data.length, width, height }).returning()
  return row!
}

// Arquivo gerado pelo próprio app (ex.: PDF da ficha D&D 5e).
export async function saveBytes(campaignId: string, data: Uint8Array, name: string) {
  const id = crypto.randomUUID()
  const storageKey = `${campaignId}/${id}.pdf`
  await putFile(storageKey, data, 'application/pdf')
  const [row] = await db.insert(asset).values({ id, campaignId, kind: 'pdf', name, mime: 'application/pdf', storageKey, size: data.length }).returning()
  return row!
}
