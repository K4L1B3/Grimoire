// Tela dividida: cada lado da mesa comporta um painel, medido em fração da largura disponível.
export type Side = 'left' | 'right'
export const DEFAULT_PANE = 0.4
const MIN_PANE = 0.15, MAX_PANE = 0.7, MAX_PANES = 0.85

// Limita o painel descontando o do lado oposto: a mesa nunca fica com menos de 15%.
export const clampPane = (size: number, other: number) => Math.max(MIN_PANE, Math.min(size, MAX_PANE, MAX_PANES - other))
