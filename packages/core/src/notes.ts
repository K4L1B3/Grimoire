// Painel de Notas: pasta da wiki indicada pelo mestre vale para a mesa toda, com tudo que está dentro dela.
type NotePage = { id: string; parentId: string | null; ownerId: string | null; kind: string; inNotes: boolean }

export const canBeNote = (p: Pick<NotePage, 'kind'>) => p.kind === 'text' || p.kind === 'map'

// Jogador só recebe o que pode ver: pasta oculta some do caminho, e o que estava dentro volta para a raiz se foi indicado.
export function noteShelf<T extends NotePage>(pages: T[]) {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const parent = (p: T) => (p.parentId ? byId.get(p.parentId) : undefined)
  // Pasta mais próxima acima da página, desde que alguma delas, em qualquer nível, esteja em Notas.
  const holder = (p: T) => {
    let nearest: T | null = null
    for (let x = parent(p); x; x = parent(x)) {
      if (x.kind !== 'folder') continue
      nearest ??= x
      if (x.inNotes) return nearest
    }
    return null
  }
  return {
    folders: pages.filter((p) => p.kind === 'folder' && (p.inNotes || holder(p))).map((page) => ({ page, parentId: holder(page)?.id ?? null })),
    notes: pages.filter((p) => p.ownerId || (canBeNote(p) && (p.inNotes || holder(p)))).map((page) => ({ page, folderId: holder(page)?.id ?? null })),
  }
}
