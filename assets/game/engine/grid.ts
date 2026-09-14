/**
 * THE GRID ITSELF.
 *
 * Every map in this engine is a rectangle of cells addressed `col,row`, and the handful of things you do with
 * one (is it on the map, walk them all, step to a neighbour, flood a region, turn a key back into a pair) were
 * written four times over: `stageGenerator` had `inBounds`, `forEachCell`, `toCell`, `floodFloor` and TWO
 * byte-identical step tables (`ORTHO` and `FLOOR_DIRS`), and `riverNetwork` had to carry its own private copies
 * of `toCell` and `inBounds` because importing them back would have made a cycle.
 *
 * They live here now. This module knows nothing about water, trees, paths or zones, which is why everything
 * else can depend on it.
 */

/** A cell, the pair the whole engine addresses a map with. */
export type Cell = { col: number; row: number }

/** A cell as the string key every set and map in the engine is keyed by. */
export const cellKey = (col: number, row: number): string => `${col},${row}`

/** A `col,row` key back into its pair. */
export const toCell = (key: string): Cell => {
  const [col, row] = key.split(',').map(Number)
  return { col, row }
}

/** Is this cell on the map? */
export const inBounds = (col: number, row: number, cols: number, rows: number): boolean =>
  col >= 0 && row >= 0 && col < cols && row < rows

/** Is this cell on the map's outer ring? */
export const isEdge = (col: number, row: number, cols: number, rows: number): boolean =>
  col === 0 || row === 0 || col === cols - 1 || row === rows - 1

/** Every cell, row-major. Row-major is not an implementation detail: generation is seeded, so the ORDER cells
 *  are visited in is part of what makes a map reproducible. */
export function forEachCell(cols: number, rows: number, visit: (col: number, row: number) => void): void {
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) visit(col, row)
  }
}

/** The four orthogonal steps. Their ORDER is load-bearing wherever a search breaks a tie by which neighbour it
 *  reached first, so treat this array as data, not as a set. */
export const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * Every cell connected to (startCol, startRow) through `isOpen`, orthogonally.
 *
 * `seen` is passed IN and mutated on purpose: labelling every region of a map means flooding from each cell in
 * turn while sharing one visited set, so the caller owns it.
 */
export function flood(
  isOpen: (col: number, row: number) => boolean,
  startCol: number,
  startRow: number,
  seen: Set<string>,
): Set<string> {
  const region = new Set<string>()
  const stack: Cell[] = [{ col: startCol, row: startRow }]
  seen.add(cellKey(startCol, startRow))
  while (stack.length > 0) {
    const { col, row } = stack.pop()!
    region.add(cellKey(col, row))
    for (const [dc, dr] of ORTHO) {
      const c = col + dc
      const r = row + dr
      const key = cellKey(c, r)
      if (seen.has(key)) continue
      if (!isOpen(c, r)) continue
      seen.add(key)
      stack.push({ col: c, row: r })
    }
  }
  return region
}
