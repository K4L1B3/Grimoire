// Visão e luz (SDD L1–L7): polígono de visão por raycasting contra as paredes (Red Blob Games),
// rasterizado numa grade de névoa. O mesmo código desenha no cliente e filtra no servidor.

export type WallKind = 'wall' | 'door' | 'window'
export type DoorState = 'open' | 'closed' | 'locked' | null
export type WallLike = { points: number[]; kind: WallKind; state: DoorState }
export type Seg = [number, number, number, number]

// Porta aberta deixa ver e passar; fechada e trancada bloqueiam; janela deixa ver mas não passar (L2).
const blocksSight = (w: WallLike) => w.kind === 'wall' || (w.kind === 'door' && w.state !== 'open')
const blocksMove = (w: WallLike) => w.kind !== 'door' || w.state !== 'open'

const segs = (walls: WallLike[], f: (w: WallLike) => boolean): Seg[] =>
  walls.filter(f).flatMap((w) => {
    const out: Seg[] = []
    for (let i = 2; i < w.points.length; i += 2) out.push([w.points[i - 2]!, w.points[i - 1]!, w.points[i]!, w.points[i + 1]!])
    return out
  })
export const sightSegments = (walls: WallLike[]) => segs(walls, blocksSight)
export const moveSegments = (walls: WallLike[]) => segs(walls, blocksMove)

// Interseção de dois segmentos (exclui toque exato nas pontas do primeiro, para o token encostado na parede).
export function crosses(ax: number, ay: number, bx: number, by: number, s: Seg) {
  const [cx, cy, dx, dy] = s
  const r = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx)
  if (r === 0) return false
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / r
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / r
  return t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1
}

export const lineOfSight = (ax: number, ay: number, bx: number, by: number, sight: Seg[]) => !sight.some((s) => crosses(ax, ay, bx, by, s))
export const moveBlocked = (ax: number, ay: number, bx: number, by: number, move: Seg[]) => move.some((s) => crosses(ax, ay, bx, by, s))

// Tira da parede o trecho sob a→b e devolve as sobras (0 a 2 paredes); null se a→b não corre por cima dela.
export function cutWall(points: number[], a: { x: number; y: number }, b: { x: number; y: number }, tol = 2): number[][] | null {
  const [ax, ay, bx, by] = points as [number, number, number, number]
  const len = Math.hypot(bx - ax, by - ay)
  if (!len) return null
  const ux = (bx - ax) / len, uy = (by - ay) / len
  const along = (p: { x: number; y: number }) => (p.x - ax) * ux + (p.y - ay) * uy
  const off = (p: { x: number; y: number }) => Math.abs((p.x - ax) * uy - (p.y - ay) * ux)
  if (off(a) > tol || off(b) > tol) return null
  const from = Math.max(0, Math.min(along(a), along(b))), to = Math.min(len, Math.max(along(a), along(b)))
  if (to - from < 1) return null
  const at = (d: number) => [ax + ux * d, ay + uy * d]
  return [...(from > 1 ? [[ax, ay, ...at(from)]] : []), ...(to < len - 1 ? [[...at(to), bx, by]] : [])]
}

// Polígono de visão a partir de (ox, oy), limitado ao retângulo da cena. Devolve [x0, y0, x1, y1, …].
export function visibilityPolygon(ox: number, oy: number, sight: Seg[], w: number, h: number): number[] {
  const all: Seg[] = [...sight, [0, 0, w, 0], [w, 0, w, h], [w, h, 0, h], [0, h, 0, 0]]
  const angles: number[] = []
  for (const [ax, ay, bx, by] of all) {
    for (const [px, py] of [[ax, ay], [bx, by]] as const) {
      const a = Math.atan2(py - oy, px - ox)
      angles.push(a - 1e-5, a, a + 1e-5)
    }
  }
  angles.sort((a, b) => a - b)
  const out: number[] = []
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a)
    let best = Infinity
    for (const [ax, ay, bx, by] of all) {
      // Raio (o + t·d) contra o segmento (a + u·(b−a)).
      const sx = bx - ax, sy = by - ay
      const den = dx * sy - dy * sx
      if (Math.abs(den) < 1e-12) continue
      const t = ((ax - ox) * sy - (ay - oy) * sx) / den
      const u = ((ax - ox) * dy - (ay - oy) * dx) / den
      if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t
    }
    if (best < Infinity) out.push(ox + dx * best, oy + dy * best)
  }
  return out
}

export function pointInPolygon(poly: number[], x: number, y: number) {
  let inside = false
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i]!, yi = poly[i + 1]!, xj = poly[j]!, yj = poly[j + 1]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Grade da névoa: no máximo ~256 células no lado maior, para caber em poucos KB.
export function fogGrid(w: number, h: number) {
  const cell = Math.max(8, Math.ceil(Math.max(w, h) / 256))
  return { cell, cols: Math.ceil(w / cell), rows: Math.ceil(h / cell) }
}

// Marca as células cujo centro está dentro do polígono e do círculo (raio 0 = sem limite). Varredura por linha.
export function rasterize(mask: Uint8Array, g: { cell: number; cols: number; rows: number }, poly: number[], cx: number, cy: number, radius: number) {
  const n = poly.length / 2
  for (let r = 0; r < g.rows; r++) {
    const y = (r + 0.5) * g.cell
    if (radius && Math.abs(y - cy) > radius) continue
    const xs: number[] = []
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = poly[i * 2 + 1]!, yj = poly[j * 2 + 1]!
      if (yi > y !== yj > y) xs.push(poly[i * 2]! + ((y - yi) / (yj - yi)) * (poly[j * 2]! - poly[i * 2]!))
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k]! / g.cell - 0.5)), c1 = Math.min(g.cols - 1, Math.floor(xs[k + 1]! / g.cell - 0.5))
      for (let c = c0; c <= c1; c++) {
        const x = (c + 0.5) * g.cell
        if (!radius || (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) mask[r * g.cols + c] = 1
      }
    }
  }
  return mask
}

export type Viewer = { x: number; y: number; vision?: { range: number; dark: number } | null }
export type LightSource = { x: number; y: number; dim: number }

// Tocha ilumina para todos, não só para o dono (L4); a de token na camada do mestre não, ou entregaria onde ele está.
export const tokenLights = (tokens: { x: number; y: number; layer: string; light?: { bright: number; dim: number } | null }[]): LightSource[] =>
  tokens.flatMap((t) => (t.light && t.layer === 'tokens' ? [{ x: t.x, y: t.y, dim: Math.max(t.light.dim, t.light.bright) }] : []))

// Células visíveis agora para um grupo de tokens (L3, L4): dentro da linha de visão de algum token e,
// no escuro, iluminadas por alguma luz (fixa ou de token, ver tokenLights) ou dentro da visão no escuro do token.
export function visibleCells(w: number, h: number, sight: Seg[], viewers: Viewer[], lights: LightSource[], dark: boolean) {
  const g = fogGrid(w, h)
  const seen = new Uint8Array(g.cols * g.rows)
  if (!viewers.length) return { ...g, mask: seen }
  let lit: Uint8Array | null = null
  if (dark) {
    lit = new Uint8Array(seen.length)
    for (const l of lights) if (l.dim > 0) rasterize(lit, g, visibilityPolygon(l.x, l.y, sight, w, h), l.x, l.y, l.dim)
  }
  for (const v of viewers) {
    const poly = visibilityPolygon(v.x, v.y, sight, w, h)
    const los = rasterize(new Uint8Array(seen.length), g, poly, v.x, v.y, v.vision?.range ?? 0)
    const darkVision = dark && v.vision?.dark ? rasterize(new Uint8Array(seen.length), g, poly, v.x, v.y, v.vision.dark) : null
    for (let i = 0; i < seen.length; i++) if (los[i] && (!lit || lit[i] || darkVision?.[i])) seen[i] = 1
  }
  return { ...g, mask: seen }
}

export const cellOf = (g: { cell: number; cols: number; rows: number }, x: number, y: number) =>
  Math.min(g.rows - 1, Math.max(0, Math.floor(y / g.cell))) * g.cols + Math.min(g.cols - 1, Math.max(0, Math.floor(x / g.cell)))

// Bits compactados (1 bit por célula) para guardar no banco e mandar pela rede.
export function packBits(mask: Uint8Array) {
  const out = new Uint8Array(Math.ceil(mask.length / 8))
  for (let i = 0; i < mask.length; i++) if (mask[i]) out[i >> 3]! |= 1 << (i & 7)
  return out
}
export function unpackBits(bytes: Uint8Array, n: number) {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = (bytes[i >> 3]! >> (i & 7)) & 1
  return out
}
