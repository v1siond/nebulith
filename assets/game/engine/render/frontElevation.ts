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
 *   for each (col, heightLevel) screen position, only the FRONT-most cell (the row nearest the viewer,
 *   i.e. the MAX row / door-facing face) is drawn; the cells behind it are hidden, and every kept cell
 *   anchors its vertical stack at the structure's FRONT row.
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

  // Depth-collapse: keep the front-most cell per (col, level), hide the rest, anchor kept cells at frontRow.
  const winnerByColLevel = new Map<string, GridAsset>()
  for (const a of componentCells) {
    const ck = `${a.col}|${lvl(a)}`
    const cur = winnerByColLevel.get(ck)
    if (!cur || a.row > cur.row) {
      if (cur) hidden.add(cur) // the previous front-runner is now occluded
      winnerByColLevel.set(ck, a)
    } else {
      hidden.add(a) // behind the current front-runner
    }
  }
  for (const winner of winnerByColLevel.values()) {
    draw.set(winner, { anchorRow: frontRow })
  }
}
