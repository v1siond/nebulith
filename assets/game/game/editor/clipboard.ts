/**
 * COPY / PASTE, Ctrl+C captures the current multi-select as a position-independent TileClip; Ctrl+V re-stamps
 * it at the hovered cell. A selection KEY is "col,row,stackIndex" (a picked TILE, its slot in the cell's
 * ordered stack) or a bare "col,row" (an empty cell region), the SAME keys the marquee/highlight speak, so
 * this reproduces exactly the tiles the user selected:
 *
 *   • the tile at the picked stack slot (`getAssetsAtCell[stackIndex]`). A FLOOR slab is captured as a ground
 *     patch (slug + colour + dims); any other tile is captured with its FULL data (label/tileOverride/color/
 *     settings/scaleX/Y/Z/height/heightLevel/pose/depth/…, every render field).
 *   • a bare "col,row" cell key falls back to the cell's FLOOR asset, so a plain ground patch still travels.
 *
 * Each captured tile records its position RELATIVE to the selection's min (col,row) anchor; its LEVEL is
 * preserved absolutely, so relative levels across a stack (a roof 3 blocks above its wall) survive the paste.
 * Paste places each tile at (anchorCol+relCol, anchorRow+relRow), REPLACING whatever occupies that cell+level
 * (replace-anything, like the tileBrush), sets collision from the tile's blocking, and re-derives the cell's
 * overall collision from the whole stack (deriveCellCollision), the SAME mutation shape selectionEdit uses.
 * Pure: no React, no grid globals, a grid in, a serializable clip out (and back).
 */
import { DEFAULT_FLOOR_SLUG, FLOOR_TYPE, type GridAsset, type IsometricGrid } from '@/engine/IsometricGrid'
import type { TilePose } from '@/engine/tileset/pose'
import { deriveCellCollision, getStack } from '@/engine/cellStack'

/** A captured FLOOR tile (a flat "col,row" key): the base-tile slug + its colour override and the floor asset's
 *  own per-cell dims/pose (Width/Height/Depth/Zoom + pose), the SAME GridAsset fields any tile carries, since
 *  the floor is just a level-0 asset. */
export interface ClipFloor {
  kind: 'floor'
  relCol: number
  relRow: number
  slug: string
  color: string | null
  scaleX?: number
  scaleY?: number
  depth?: number
  pose?: TilePose
}

/** A captured stacked ASSET tile (a "col,row,level" block key): the full GridAsset, plus its recorded LEVEL.
 *  `asset.col/row` are ignored on paste, position comes from anchor + rel; the level is preserved absolutely. */
export interface ClipAsset {
  kind: 'asset'
  relCol: number
  relRow: number
  level: number
  asset: GridAsset
}

export type ClipTile = ClipFloor | ClipAsset

/** The serializable clipboard payload: the captured tiles, each positioned relative to the selection anchor. */
export interface TileClip {
  tiles: ClipTile[]
}

/** A decoupled, serializable snapshot of an asset (arrays/objects deep-copied) so the clip never aliases the
 *  live grid, a later grid edit can't mutate a copied tile, and paste can re-stamp the same clip many times. */
const cloneAsset = (a: GridAsset): GridAsset => structuredClone(a)

/** Ctrl+C: capture the tiles the selection KEYS refer to, positioned relative to the selection's min corner.
 *  A block key → the asset covering that level (with full data); a flat key → the cell's floor. Empty in →
 *  empty clip. Never mutates the grid. */
export function copyTiles(grid: IsometricGrid, keys: Iterable<string>): TileClip {
  const parsed = [...keys]
    .map((k) => {
      const [col, row, stackIndex] = k.split(',').map(Number)
      return { col, row, stackIndex, flat: !Number.isFinite(stackIndex) }
    })
    .filter((p) => Number.isFinite(p.col) && Number.isFinite(p.row))
  if (parsed.length === 0) return { tiles: [] }

  const minCol = Math.min(...parsed.map((p) => p.col))
  const minRow = Math.min(...parsed.map((p) => p.row))
  const tiles: ClipTile[] = []
  for (const p of parsed) {
    const relCol = p.col - minCol
    const relRow = p.row - minRow
    // The picked TILE is the cell's stack slot; a bare "col,row" cell key falls back to the cell's floor asset.
    const target = p.flat ? grid.floorAt(p.col, p.row) : grid.getAssetsAtCell(p.col, p.row)[p.stackIndex]
    if (!target) continue // an empty cell / stale slot → nothing to copy for that key
    if (target.type === FLOOR_TYPE) {
      // The FLOOR slab travels as a ground patch (slug + colour + its own dims/pose), re-laid via setGround.
      tiles.push({
        kind: 'floor',
        relCol,
        relRow,
        slug: target.tileKey ?? DEFAULT_FLOOR_SLUG,
        color: target.color ?? null,
        scaleX: target.scaleX,
        scaleY: target.scaleY,
        depth: target.depth,
        pose: target.pose,
      })
      continue
    }
    tiles.push({ kind: 'asset', relCol, relRow, level: target.heightLevel ?? 0, asset: cloneAsset(target) })
  }
  return { tiles }
}

/** Ctrl+V: re-stamp the clip with its min corner at (anchorCol, anchorRow). Each tile lands at
 *  (anchorCol+relCol, anchorRow+relRow) at its preserved level, REPLACING whatever occupies that cell+level;
 *  collision is set from the tile's blocking then re-derived from the whole stack. Targets that fall off the
 *  grid are skipped. Returns the number of tiles placed. */
export function pasteTiles(grid: IsometricGrid, clip: TileClip, anchorCol: number, anchorRow: number): number {
  let count = 0
  for (const t of clip.tiles) {
    const col = anchorCol + t.relCol
    const row = anchorRow + t.relRow
    if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue // off-grid → skip

    if (t.kind === 'floor') {
      grid.setGround(col, row, t.slug) // place/replace the base-tile slug (creates the floor asset if absent)
      const floor = grid.floorAt(col, row)
      if (floor) {
        // Re-apply the captured floor asset's own fields, the SAME GridAsset props any tile round-trips.
        floor.color = t.color ?? undefined
        floor.scaleX = t.scaleX
        floor.scaleY = t.scaleY
        floor.depth = t.depth
        floor.pose = t.pose
      }
      count++
      continue
    }

    const level = t.level
    // Replace-anything: drop whatever already sits at this cell+level, then stamp the clip's tile there.
    grid.removeAssetsWhere((a) => a.col === col && a.row === row && (a.heightLevel ?? 0) === level)
    placeClipAsset(grid, t.asset, col, row, level)
    // Collision from the tile's blocking, re-derived across the whole stack (unblock / stay-blocked correctly).
    grid.setCollision(col, row, deriveCellCollision(getStack(grid, col, row)))
    count++
  }
  return count
}

/**
 * Place a captured asset at (col,row,level), reproducing EVERY render field.
 *
 * This was two hand-written field lists: one of options handed to `placeAsset`, and a second one
 * assigning afterwards the fields the first could not carry. Both fell behind `GridAsset`, and a
 * pasted tile quietly lost whatever neither list mentioned. `placeAsset` carries everything now, so
 * the capture goes across whole.
 *
 * Cloned per placement, so pasting the same clip twice yields fully independent instances and no two
 * pasted tiles share a nested settings, pose or animation object.
 */
function placeClipAsset(grid: IsometricGrid, captured: GridAsset, col: number, row: number, level: number): void {
  const src = structuredClone(captured)

  grid.placeAsset([...(src.art ?? [])], col, row, { ...src, heightLevel: level })
}
