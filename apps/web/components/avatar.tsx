export const DEFAULT_AVATAR = '/avatars/default.svg'

// Foto de perfil da pessoa; `image` é uma URL (avatar do sistema, foto enviada ou Discord).
export function UserPhoto({ image, className = 'size-9' }: { image?: string | null; className?: string }) {
  return <img src={image ?? DEFAULT_AVATAR} alt="" className={`shrink-0 rounded-full bg-raised object-cover ${className}`} />
}

// Retrato de personagem; sem imagem, as iniciais. Borda azul para personagem, vermelha para criatura.
export function Avatar({ name, image, pc, className = 'size-9' }: { name: string; image?: string | null; pc?: boolean; className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full border-2 bg-raised bg-cover bg-center text-[10px] font-bold ${pc ? 'border-info' : 'border-fumble/70'} ${className}`}
      style={image ? { backgroundImage: `url(/api/assets/${image})` } : undefined} aria-hidden>{!image && name.slice(0, 2).toUpperCase()}</span>
  )
}
