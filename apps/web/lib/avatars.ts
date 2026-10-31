import 'server-only'
import path from 'node:path'
import { readdir } from 'node:fs/promises'
import sharp from 'sharp'
import { DEFAULT_AVATAR } from '@/components/avatar'
import { deleteFile, putFile } from '@/lib/storage'

// Avatares do sistema: toda imagem em public/avatars entra na lista, sem precisar mexer em código.
const DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), 'public/avatars')

export async function systemAvatars() {
  const files = await readdir(DIR)
  const rest = files.filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f)).sort().map((f) => `/avatars/${f}`)
  return [DEFAULT_AVATAR, ...rest.filter((a) => a !== DEFAULT_AVATAR)]
}

const MAX_BYTES = 10 * 1024 * 1024

// Foto de perfil: fora da tabela asset porque é da pessoa, não de uma campanha (e pode vir antes de ela ter alguma).
export const avatarKey = (id: string) => `avatars/${id}.webp`

export async function saveAvatar(file: File) {
  if (file.size > MAX_BYTES) throw new Error('Arquivo maior que 10 MB')
  const data = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 16384 * 16384 }).rotate().resize(256, 256).webp({ quality: 85 }).toBuffer()
    .catch(() => { throw new Error('Não consegui ler essa imagem') })
  const id = crypto.randomUUID()
  await putFile(avatarKey(id), data, 'image/webp')
  return `/api/avatar/${id}`
}

// Foto trocada não fica guardada; avatar do sistema e foto do Discord não têm o que apagar.
export async function deleteAvatar(image?: string | null) {
  const id = /^\/api\/avatar\/([0-9a-f-]{36})$/.exec(image ?? '')?.[1]
  if (id) await deleteFile(avatarKey(id))
}
