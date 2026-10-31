// Modelos prontos de página (W10). Conteúdo no formato do TipTap, aplicado na primeira abertura da página.
type Doc = { type: 'doc'; content: object[] }
const h = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const p = (text = '') => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const fields = (...names: string[]) => ({
  type: 'table',
  content: names.map((n) => ({ type: 'tableRow', content: [{ type: 'tableHeader', content: [p(n)] }, { type: 'tableCell', content: [p()] }] })),
})
const doc = (...content: object[]): Doc => ({ type: 'doc', content })

export const BUILTIN_TEMPLATES: Record<string, { label: string; doc: Doc }> = {
  personagem: { label: 'Personagem', doc: doc(fields('Raça', 'Ocupação', 'Facção', 'Onde vive'), h('Aparência'), p(), h('Personalidade'), p(), h('História'), p(), { type: 'secretBlock', attrs: { id: null } }) },
  local: { label: 'Local', doc: doc(fields('Região', 'Governante', 'População'), h('Descrição'), p(), h('Pontos de interesse'), { type: 'bulletList', content: [{ type: 'listItem', content: [p()] }] }, h('Ganchos'), p()) },
  faccao: { label: 'Facção', doc: doc(fields('Líder', 'Sede', 'Objetivo'), h('Membros'), p(), h('Aliados e inimigos'), p(), h('Segredos'), { type: 'secretBlock', attrs: { id: null } }) },
  item: { label: 'Item', doc: doc(fields('Tipo', 'Raridade', 'Valor', 'Peso'), h('Descrição'), p(), h('Propriedades'), p()) },
  evento: { label: 'Evento', doc: doc(fields('Data', 'Local', 'Envolvidos'), h('O que aconteceu'), p(), h('Consequências'), p()) },
}
