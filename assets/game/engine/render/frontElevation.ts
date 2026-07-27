import type { GridAsset } from '@/engine/IsometricGrid'

/**
 * 2D FRONT-ELEVATION projection (MAP-MODEL.md §2-3, REQUIREMENTS-cell-block-tile §1/§C).
 *
 * The 2D view is a true **Width × Height** front elevation: the horizontal screen axis is `col` (width),
 * the vertical screen axis is `heightLevel` (stack UP), and **DEPTH (row / dy) is COLLAPSED**. A building
 * must therefore read its TRUE height (its level count) and NEVER inflate by its depth — the old per-cell
 * projection drew each cell at its own (col,row) raised by heightLevel, so a 4-deep × 5-tall house piled up
 * ~9 cells tall (depth + height). This helper collapses that depth:
 *
 *   for each (col, heightLevel) screen position the cells overlap; a cell is hidden only when a cell IN
 *   FRONT of it (nearer the viewer / higher row) is at LEAST as TALL — real occlusion, not row alone. Equal-
 *   height rows (a wall column, a back wall behind its door) collapse to the front-most exactly as before,
 *   but a cell TALLER than everything in front of it survives and draws its extra height above the front
 *   face. Every kept cell anchors its vertical stack at the structure's FRONT row.
 *
 * This occlusion rule is what keeps a FLAT composition (fountain, well — all cells at level 0 but spanning
 * depth) visible in 2D: its rim is 1 block, its interior water grows to ~4, so the water peeks over the front
 * rim instead of being dropped behind it. Under the old front-most-row rule the whole water body hid and the
 * fountain read as a bare strip of rim (MAP-MODEL §5 — a composition cell resolves by its LABEL in EVERY view).
 *
 * It is a pure PROJECTION — no per-type "if building" branch. Any stacked structure that has real depth
 * (a column occupied at more than one row: buildings, multi-deep trees) collapses identically. A structure
 * with no depth (a 1-deep tree/bush, a lone prop) has nothing to collapse and passes through untouched, so
 * the existing flat-prop / single-column-tree path is byte-identical.
 *
 * Grouping is by connected component (4-adjacency over the occupied cells of the placed composition assets),
 * so two separate buildings that share a screen column but sit in different row bands keep their OWN front
 * rows instead of one swallowing the other.
 */

export interface FrontElevationCell {
  /** The row to ANCHOR this cell's vertical stack at — the structure's front (viewer-nearest) row. The
   *  cell draws at (col, anchorRow) raised by its heightLevel, so the whole facade sits on one ground line. */
  anchorRow: number
}

export interface FrontElevation {
  /** Assets to draw at the anchored front-elevation position (keyed by the placed asset). */
  draw: Map<GridAsset, FrontElevationCell>
  /** Assets occluded by a front cell — skip them entirely. */
  hidden: Set<GridAsset>
}

const key = (col: number, row: number): string => `${col},${row}`
const lvl = (a: GridAsset): number => a.heightLevel ?? 0

/** A cell participates in the front-elevation collapse only if it is a placed COMPOSITION cell (a wall,
 *  roof, door, window, tree leaf …) — those carry a `label`. Flat props (crates, lamps, npcs) and the
 *  live player have no label, so they never collapse and keep their own row. */
const isStructureCell = (a: GridAsset): boolean => a.label != null

/** The MAX vertical extent (in tile/block units) a cell can draw — its base height AND the peak of any
 *  height-grow animation. Used by the depth-collapse to decide OCCLUSION: a front cell only hides a cell
 *  behind it when the front cell is at LEAST as tall (so an equal-height wall row still dedupes, but a TALL
 *  cell behind a SHORT one survives — the fountain water, which grows 1→4 blocks, peeking over its 1-block
 *  rim). `height` composes ADDITIVELY onto `scaleY` (tileAnimation ADDITIVE_SETTINGS: rendered = base +
 *  (value − from)), so a `1→4` grow lifts scaleY to `base + (4 − 1)`. An upper bound is safe here — it only
 *  ever KEEPS more, never wrongly hides. */
function cellFrontHeight(a: GridAsset): number {
  const baseScaleY = a.scaleY ?? 1
  const dims = (scaleY: number): number => (a.height ?? 1) * scaleY * (a.scale ?? 1)
  let peak = dims(baseScaleY)
  for (const anim of a.animations ?? []) {
    if (anim.kind !== 'settings') continue
    for (const t of anim.tracks) {
      // height → scaleY (ADDITIVE). Only numeric tracks stretch the block; colour/display don't.
      if (t.setting !== 'height' || typeof t.from !== 'number' || typeof t.to !== 'number') continue
      peak = Math.max(peak, dims(baseScaleY + (Math.max(t.from, t.to) - t.from)))
    }
  }
  return peak
}

/** Compute the front-elevation projection for a set of placed assets. See the module doc. */
export function frontElevation(assets: readonly GridAsset[]): FrontElevation {
  const draw = new Map<GridAsset, FrontElevationCell>()
  const hidden = new Set<GridAsset>()

  const cells = assets.filter(isStructureCell)
  if (cells.length === 0) return { draw, hidden }

  // Index the structure cells by grid position for adjacency walks + per-position bucketing.
  const byCell = new Map<string, GridAsset[]>()
  for (const a of cells) {
    const k = key(a.col, a.row)
    const list = byCell.get(k)
    if (list) list.push(a)
    else byCell.set(k, [a])
  }

  // Connected components over 4-adjacent occupied positions.
  const seen = new Set<string>()
  for (const startKey of byCell.keys()) {
    if (seen.has(startKey)) continue
    const componentKeys: string[] = []
    const stack = [startKey]
    seen.add(startKey)
    while (stack.length > 0) {
      const k = stack.pop() as string
      componentKeys.push(k)
      const [c, r] = k.split(',').map(Number)
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nk = key(c + dc, r + dr)
        if (byCell.has(nk) && !seen.has(nk)) {
          seen.add(nk)
          stack.push(nk)
        }
      }
    }
    collapseComponent(componentKeys, byCell, draw, hidden)
  }

  return { draw, hidden }
}

/** Collapse ONE connected component's depth into a front elevation. A component with no depth (every column
 *  occupies a single row) is left untouched (pass-through). Otherwise the front row = the component's MAX
 *  row; for each (col, level) the front-most (max-row) cell wins and anchors at the front row, the rest hide. */
function collapseComponent(
  componentKeys: readonly string[],
  byCell: Map<string, GridAsset[]>,
  draw: Map<GridAsset, FrontElevationCell>,
  hidden: Set<GridAsset>,
): void {
  const componentCells: GridAsset[] = []
  for (const k of componentKeys) {
    const list = byCell.get(k)
    if (list) componentCells.push(...list)
  }

  // Depth to collapse? True iff some column is occupied at more than one row (a front + back face).
  const rowsByCol = new Map<number, Set<number>>()
  let frontRow = -Infinity
  for (const a of componentCells) {
    frontRow = Math.max(frontRow, a.row)
    const rows = rowsByCol.get(a.col)
    if (rows) rows.add(a.row)
    else rowsByCol.set(a.col, new Set([a.row]))
  }
  let hasDepth = false
  for (const rows of rowsByCol.values()) {
    if (rows.size > 1) { hasDepth = true; break }
  }
  if (!hasDepth) return // no depth — a 1-deep tree / single-column structure renders as-is

  // Depth-collapse by OCCLUSION, not by row alone: bucket cells per (col, level) — they overlap on the
  // front-elevation screen column — and HIDE a cell only when a cell IN FRONT of it (nearer the camera =
  // higher row) is at LEAST as tall. Equal-height rows (a wall column, a building's back wall behind its
  // door) dedupe to the front-most exactly as before; but a cell that is TALLER than everything in front of
  // it survives, so it draws its extra height above the front face. This is what keeps a FLAT composition's
  // body visible: the fountain / well rim is 1 block, its interior water grows to ~4 — the water would
  // otherwise hide entirely behind the front rim row (MAP-MODEL §5 — every composition cell resolves in
  // every view). Kept cells anchor at the structure's front row so the facade sits on one ground line.
  const byColLevel = new Map<string, GridAsset[]>()
  for (const a of componentCells) {
    const ck = `${a.col}|${lvl(a)}`
    const bucket = byColLevel.get(ck)
    if (bucket) bucket.push(a)
    else byColLevel.set(ck, [a])
  }
  for (const bucket of byColLevel.values()) {
    for (const a of bucket) {
      const h = cellFrontHeight(a)
      const occluded = bucket.some(o => o !== a && o.row > a.row && cellFrontHeight(o) >= h)
      if (occluded) hidden.add(a)
      else draw.set(a, { anchorRow: frontRow })
    }
  }
}
