// LIVE stamp for a multi-cell COMPOSITION (tree / house / fountain / lamp …) — the data-driven, ALL-asset
// twin of stampBuildingCells. Reads the composition (footprint + per-cell tile) from the LOADED DB tileset
// and places one labeled per-cell asset per cell; each cell's glyph + colour come from resolveTile (DB), its
// collision from the cell's `walkable` flag, its stack from `level`. The three views then draw each cell
// through the generic per-cell path (drawIsoLabeledCell / draw2DLabeledCell / the birdseye per-cell pass) —
// NO per-type drawer. This is how "everything is a collection of ascii tiles from the backend" is enforced.
import { resolveComposition, resolveTile } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import type { IsometricGrid } from '@/engine/IsometricGrid'
import type { ZoneId } from '@/engine/zones'

/** Stamp composition `kind` at anchor (col,row). Returns the number of cells placed (0 if the kind has no
 *  composition in the loaded tileset). `variant` picks the per-cell canopy shade (a tree's green/brown tone). */
export function stampComposition(grid: IsometricGrid, kind: string, anchorCol: number, anchorRow: number, zone: ZoneId, variant = 0): number {
  const comp = resolveComposition(ASCII_TILESET, kind)
  if (!comp) return 0
  let placed = 0
  for (const c of comp.cells) {
    const col = anchorCol + c.dx
    const row = anchorRow + c.dy
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue
    const tile = resolveTile(ASCII_TILESET, zone, c.label, variant)
    // Only the LEVEL-0 tile sits on the ground, so only it casts a base shadow — a shadow under a lifted
    // canopy tile would float at canopy height (the same rule the old glade-tree stamper used).
    const grounded = (c.level ?? 0) === 0 || undefined
    const asset = grid.placeAsset([tile.char], col, row, { type: kind, blocking: !c.walkable, color: tile.color, heightLevel: c.level ?? 0, baseShadow: grounded })
    asset.label = c.label // the generic per-cell drawer keys off `label`; the glyph is asset.art[0] (resolved above)
    asset.height = 1
    // Block ONLY for a non-walkable tile, and never UNblock: a cell can hold both a blocking trunk (low level)
    // and a walkable canopy tile (higher level) — the walkable one, placed later, must not clear the trunk's collision.
    if (!c.walkable) grid.setCollision(col, row, true)
    placed++
  }
  return placed
}
