// LIVE stamp for a multi-cell COMPOSITION (tree / bush / house / store …) — the data-driven, ALL-asset
// path every pre-built asset uses. Reads the composition (footprint + per-cell tile) from the LOADED DB
// tileset and places one labeled per-cell asset per cell; each cell's glyph + colour come from resolveTile
// (DB), its collision from the cell's `walkable` flag, its stack from `level`. The three views then draw
// each cell through the generic per-cell path (drawIsoLabeledCell / draw2DLabeledCell / the birdseye
// per-cell pass) — NO per-type drawer. A pre-built BUILDING is stamped through THIS exact path (rotated to
// face its road), not a special building unit — that is how "everything is a collection of backend tiles"
// is enforced.
import { resolveComposition, resolveTile, tileRenderBehavior } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import type { IsometricGrid } from '@/engine/IsometricGrid'
import type { ZoneId } from '@/engine/zones'
import type { BuildingType } from '@/engine/buildingTypes'
import type { Facing } from '@/engine/villageLayout'
import { buildingCompositionKind, facingRotation, rotateFootprintOffset } from '@/engine/buildingCatalog'

// Apex-signage colour for a titled building — a single readable signage tone drawn on drawApexBadge's
// dark backing. The building NAME is the DATA (the composition's `title`); the colour is a fixed render
// constant (the old per-type gold/white marquee collapses now that only the name is data).
const BADGE_COLOR = '#ffffff'

/** Stamp composition `kind` at anchor (col,row). Returns the number of cells placed (0 if the kind has no
 *  composition in the loaded tileset). `variant` picks the per-cell canopy shade (a tree's green/brown tone).
 *  `rotation` (CW quarter-turns) rotates the footprint around its anchor so a building can face its road;
 *  trees/props leave it 0 (unrotated). The anchor stays the footprint's origin/top-left after rotation. */
// One wall MATERIAL is chosen per BUILDING at generation and rewritten onto its wall pieces here, so the
// composition stays SHAPE-only (a building never mixes materials; variety is BETWEEN buildings). Rewrites
// ONLY `wall_<material>_<pos>` cells — roofs/windows/doors/signage keep their own labels. `material` is a
// wall base like "wall_stone"; absent → the composition's authored material stands (store/hospital/civic).
const WALL_MAT = /^wall_(stone|brick|wood|plaster)_/

export function stampComposition(grid: IsometricGrid, kind: string, anchorCol: number, anchorRow: number, zone: ZoneId, variant = 0, rotation = 0, material?: string): number {
  const comp = resolveComposition(ASCII_TILESET, kind)
  if (!comp) return 0
  const { w, h } = comp.footprint
  let placed = 0
  for (const c of comp.cells) {
    const off = rotation ? rotateFootprintOffset(c.dx, c.dy, w, h, rotation) : { dx: c.dx, dy: c.dy }
    const col = anchorCol + off.dx
    const row = anchorRow + off.dy
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue
    const label = material ? c.label.replace(WALL_MAT, `${material}_`) : c.label
    const tile = resolveTile(ASCII_TILESET, zone, label, variant)
    // Only the LEVEL-0 tile sits on the ground, so only it casts a base shadow — a shadow under a lifted
    // canopy/roof tile would float at that height (the same rule the old glade-tree stamper used).
    const grounded = (c.level ?? 0) === 0 || undefined
    const asset = grid.placeAsset([tile.char], col, row, { type: kind, blocking: !c.walkable, color: tile.color, heightLevel: c.level ?? 0, baseShadow: grounded })
    asset.label = label // the generic per-cell drawer keys off `label`; the glyph is asset.art[0] (resolved above)
    asset.height = 1
    // Copy the tile's GENERIC behavior (fadeNear/cutawayRoof) so ANY composition cell — a leaf, a wall, a
    // roof — fades/cuts away near the hero exactly the same, driven by the ONE settings-reading render path.
    const behavior = tileRenderBehavior(tile.settings)
    if (behavior) asset.settings = behavior
    // Apex signage: a titled composition (a store / hospital carries its NAME as data) badges its ONE
    // roof-apex cell with that name — attached to the SAME generic `settings.badge` the renderer already
    // reads, so there is no per-type lookup. Houses/others carry no title → no badge.
    if (comp.title && c.label.startsWith('roof_top')) {
      asset.settings = { ...(asset.settings ?? {}), badge: { text: comp.title, color: BADGE_COLOR } }
    }
    // Block ONLY for a non-walkable tile, and never UNblock: a cell can hold both a blocking low tile
    // (trunk / wall) and a walkable higher tile (canopy / roof) — the walkable one, placed later, must not
    // clear the low tile's collision.
    if (!c.walkable) grid.setCollision(col, row, true)
    placed++
  }
  return placed
}

/** Stamp a pre-built BUILDING (house/store/hospital/…) as its composition's per-cell tiles at the
 *  footprint TOP-LEFT (anchorCol,anchorRow), rotated so its door faces `facing`'s road — the SAME stamp
 *  trees use, no special building drawer. Returns the number of cells placed (0 if the composition for the
 *  (type,length) isn't in the loaded tileset). */
export function stampBuildingComposition(grid: IsometricGrid, type: BuildingType, length: number, anchorCol: number, anchorRow: number, zone: ZoneId, facing: Facing, material?: string): number {
  return stampComposition(grid, buildingCompositionKind(type, length), anchorCol, anchorRow, zone, 0, facingRotation(facing), material)
}
