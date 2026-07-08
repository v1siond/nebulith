/**
 * Fill a multi-cell selection with a composite asset by TILING its pattern.
 *
 * A composite (well, hut, …) is a small fixed pattern of tiles at (dx,dy) offsets.
 * The editor used to stamp it ONCE at the first selected cell, so selecting 40
 * cells and clicking "well" gave a hardcoded 2×2 well. Here the pattern repeats by
 * its own width/height across the selection's bounding box and is clipped to the
 * SELECTED cells — so the asset fills exactly the region the user chose.
 *
 * Pure placement logic (kept out of the editor component so it's unit-testable):
 * it mutates the grid via placeAsset, no React state.
 */
import type { IsometricGrid } from './IsometricGrid'

export interface CompositeTile {
  tile: string
  char: string
  dx: number
  dy: number
  blocking: boolean
  type: string
  color?: string
  bgColor?: string
  height?: number
}

const parseCell = (key: string): { col: number; row: number } => {
  const [col, row] = key.split(',').map(Number)
  return { col, row }
}

export function fillSelectionWithComposite(
  grid: IsometricGrid,
  tiles: readonly CompositeTile[],
  selectedCells: ReadonlySet<string>,
): void {
  if (tiles.length === 0 || selectedCells.size === 0) return

  const cells = [...selectedCells].map(parseCell)
  const minCol = Math.min(...cells.map(c => c.col))
  const minRow = Math.min(...cells.map(c => c.row))
  const patternW = Math.max(...tiles.map(t => t.dx)) + 1
  const patternH = Math.max(...tiles.map(t => t.dy)) + 1
  const byOffset = new Map(tiles.map(t => [`${t.dx},${t.dy}`, t]))

  for (const { col, row } of cells) {
    // Which pattern cell tiles this position (repeat by pattern size, wrap-safe).
    const pdx = (((col - minCol) % patternW) + patternW) % patternW
    const pdy = (((row - minRow) % patternH) + patternH) % patternH
    const tile = byOffset.get(`${pdx},${pdy}`)
    if (!tile) continue // a gap in a non-rectangular pattern → leave the cell empty

    grid.removeAssetsWhere(a => a.col === col && a.row === row) // replace
    grid.placeAsset([tile.char], col, row, {
      type: tile.type,
      blocking: tile.blocking,
      color: tile.color,
      bgColor: tile.bgColor,
      height: tile.height ?? 0,
      tileKey: tile.tile,
    })
  }
}

/**
 * SCALE a composite to span the selection's bounding box as ONE instance.
 * Each bounding-box cell maps (nearest-neighbour) to a pattern cell, so a 2×2 well
 * selected over 10×10 becomes a single 10×10 well — not a 5×5 grid of little wells.
 * (This is the "select a region → one big asset" behaviour, vs the tiling above.)
 */
export function scaleCompositeToRegion(
  grid: IsometricGrid,
  tiles: readonly CompositeTile[],
  selectedCells: ReadonlySet<string>,
): void {
  if (tiles.length === 0 || selectedCells.size === 0) return

  const cells = [...selectedCells].map(parseCell)
  const minCol = Math.min(...cells.map(c => c.col))
  const maxCol = Math.max(...cells.map(c => c.col))
  const minRow = Math.min(...cells.map(c => c.row))
  const maxRow = Math.max(...cells.map(c => c.row))
  const regionW = maxCol - minCol + 1
  const regionH = maxRow - minRow + 1
  const patternW = Math.max(...tiles.map(t => t.dx)) + 1
  const patternH = Math.max(...tiles.map(t => t.dy)) + 1
  const byOffset = new Map(tiles.map(t => [`${t.dx},${t.dy}`, t]))

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const pdx = Math.min(patternW - 1, Math.floor(((col - minCol) / regionW) * patternW))
      const pdy = Math.min(patternH - 1, Math.floor(((row - minRow) / regionH) * patternH))
      const tile = byOffset.get(`${pdx},${pdy}`)
      if (!tile) continue // a gap in a non-rectangular pattern stays empty
      grid.removeAssetsWhere(a => a.col === col && a.row === row)
      grid.placeAsset([tile.char], col, row, {
        type: tile.type,
        blocking: tile.blocking,
        color: tile.color,
        bgColor: tile.bgColor,
        height: tile.height ?? 0,
        tileKey: tile.tile,
      })
    }
  }
}
