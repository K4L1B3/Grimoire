// Única fonte de verdade da matriz de permissões (SDD §3). Toda leitura e escrita no servidor passa por can().

export type Role = 'gm' | 'player' | 'observer'
export type Member = { userId: string; role: Role }
export type PageVisibility = 'hidden' | 'visible' | 'editable'
export type RollVisibility = 'public' | 'hidden' | 'private'

type Resources = {
  'page.view': { visibility: PageVisibility; ownerId?: string | null }
  'page.edit': { visibility: PageVisibility; ownerId?: string | null; kind?: string }
  'secret.view': { visibleTo: string[] }
  'template.edit': null
  'sheet.edit': { ownerIds: string[] }
  'scene.edit': null
  'token.move': { ownerIds: string[] }
  'gmLayer.view': null
  'fog.bypass': null
  'roll': { visibility: RollVisibility }
}
export type Action = keyof Resources

// Regras para quem não é mestre; o mestre pode tudo.
const rules: { [A in Action]: (m: Member, r: Resources[A]) => boolean } = {
  'page.view': (m, r) => r.visibility !== 'hidden',
  // Nota da wiki (texto, mapa) é só leitura para o jogador; "editável" vale para quadro e linha do tempo.
  'page.edit': (m, r) => m.role === 'player' && r.visibility === 'editable' && (r.kind === 'board' || r.kind === 'timeline'),
  'secret.view': (m, r) => m.role === 'player' && r.visibleTo.includes(m.userId),
  'template.edit': () => false,
  'sheet.edit': (m, r) => m.role === 'player' && r.ownerIds.includes(m.userId),
  'scene.edit': () => false,
  'token.move': (m, r) => m.role === 'player' && r.ownerIds.includes(m.userId),
  'gmLayer.view': () => false,
  'fog.bypass': () => false,
  'roll': (m, r) => m.role === 'player' && r.visibility !== 'hidden',
}

export function can<A extends Action>(member: Member | null, action: A, resource: Resources[A]): boolean {
  if (!member) return false
  // Nota pessoal é só do dono: é a única coisa que nem o mestre vê.
  if (resource && 'ownerId' in resource && resource.ownerId) return resource.ownerId === member.userId
  if (member.role === 'gm') return true
  return rules[action](member, resource)
}
