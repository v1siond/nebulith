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

// A cell's COLOUR is a per-tile SETTING (TILESET-AUTHORING §1, TILE-BACKEND-MIGRATION §5) — the engine
// FILTERS the baked tile to it at draw time (render/shared.ts tintedImage, luminance-mapped). The generator
// can therefore override a building's ROOF / WALL colour without touching the composition SHAPE. A ROOF cell
// is the whole roof volume: the gable body/cap (`roof*` — also catches `rooftop_unit`), plus the flat-roof
// deck (`flat_roof`) and its parapet lip (`parapet`), which don't start with "roof". A WALL cell is any
// `wall_*` material piece. Windows / doors / awnings / storefront glass keep their OWN colour. An absent
// override → the tile's authored colour stands, so a colour-less stamp is byte-identical to before.
const isRoofLabel = (label: string): boolean => label.startsWith('roof') || label === 'flat_roof' || label === 'parapet'
const isWallLabel = (label: string): boolean => label.startsWith('wall_')

export function stampComposition(grid: IsometricGrid, kind: string, anchorCol: number, anchorRow: number, zone: ZoneId, variant = 0, rotation = 0, material?: string, roofColor?: string, wallColor?: string): number {
  const comp = resolveComposition(ASCII_TILESET, kind)
  if (!comp) return 0
  const { w, h } = comp.footprint
  // PERF + "intelligent building" (Alexander): collapse each vertical RUN of the SAME tile at a footprint cell
  // into ONE block sized `scaleY = run length`, instead of N stacked unit cubes — a wall column of 4 becomes 1
  // block (fewer draws + no hidden-interior overdraw). Windows / doors / roof caps have their own label so they
  // break the run and stay their own block. Reuses the composition data as-is; scaleY renders identically
  // (ISO + 2D) to the old stack, so the look is unchanged.
  type Cell = (typeof comp.cells)[number]
  const columns = new Map<string, Cell[]>()
  for (const c of comp.cells) {
    const key = `${c.dx},${c.dy}`
    const run = columns.get(key)
    if (run) run.push(c)
    else columns.set(key, [c])
  }
  // Trees keep every cell an independently selectable block (the picker + the 3-segment tree work rely on
  // it); only BUILDINGS/fountain/etc. collapse. Their own dedicated sizing comes with the tree ticket.
  const canCollapse = !kind.startsWith('tree')
  let placed = 0
  for (const cells of columns.values()) {
    cells.sort((a: Cell, b: Cell) => (a.level ?? 0) - (b.level ?? 0))
    for (let i = 0; i < cells.length; ) {
      let j = i
      while (
        canCollapse &&
        j + 1 < cells.length &&
        (cells[j + 1].level ?? 0) === (cells[j].level ?? 0) + 1 &&
        cells[j + 1].label === cells[i].label &&
        cells[j + 1].walkable === cells[i].walkable
      )
        j++
      if (stampRun(grid, comp, kind, cells[i], j - i + 1, anchorCol, anchorRow, w, h, rotation, zone, variant, material, roofColor, wallColor)) placed += j - i + 1
      i = j + 1
    }
  }
  return placed
}

/** Place ONE run of a composition column at its base level, sized `scaleY = span` so a vertical run of the
 *  same tile renders as a single taller block (1 draw) instead of `span` stacked unit cubes. Returns whether
 *  it landed on the grid. */
function stampRun(
  grid: IsometricGrid,
  comp: NonNullable<ReturnType<typeof resolveComposition>>,
  kind: string,
  c: { dx: number; dy: number; level?: number; label: string; walkable?: boolean; scale?: number },
  span: number,
  anchorCol: number,
  anchorRow: number,
  w: number,
  h: number,
  rotation: number,
  zone: ZoneId,
  variant: number,
  material: string | undefined,
  roofColor: string | undefined,
  wallColor: string | undefined,
): boolean {
  const off = rotation ? rotateFootprintOffset(c.dx, c.dy, w, h, rotation) : { dx: c.dx, dy: c.dy }
  const col = anchorCol + off.dx
  const row = anchorRow + off.dy
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false
  const label = material ? c.label.replace(WALL_MAT, `${material}_`) : c.label
  const tile = resolveTile(ASCII_TILESET, zone, label, variant)
  // Colour SETTING = the filter the renderer tints the baked tile to. A roof/wall override recolours just
  // those cells; every other cell (and any absent override) keeps the tile's own colour.
  const color = isRoofLabel(label) && roofColor ? roofColor : isWallLabel(label) && wallColor ? wallColor : tile.color
  const grounded = (c.level ?? 0) === 0 || undefined
  // The cell's uniform draw ZOOM (backend `composition_cells.scale`) — the render reads asset.scale as its
  // zoom, so a cell can hold a tile bigger than one block (the tree's canopy = one leaf cell at scale 2).
  const asset = grid.placeAsset([tile.char], col, row, { type: kind, blocking: !c.walkable, color, heightLevel: c.level ?? 0, baseShadow: grounded, scale: c.scale })
  asset.label = label
  asset.height = 1
  // The collapsed vertical run → ONE block `span` tall (scaleY grows UP from the base level; ISO + 2D).
  if (span > 1) asset.scaleY = span
  const behavior = tileRenderBehavior(tile.settings)
  if (behavior) asset.settings = behavior
  // Apex signage: a titled composition (store/hospital) badges its ONE roof-apex cell with its NAME.
  if (comp.title && c.label.startsWith('roof_top')) {
    asset.settings = { ...(asset.settings ?? {}), badge: { text: comp.title, color: BADGE_COLOR } }
  }
  if (!c.walkable) grid.setCollision(col, row, true)
  return true
}

/** Stamp a pre-built BUILDING (house/store/hospital/…) as its composition's per-cell tiles at the
 *  footprint TOP-LEFT (anchorCol,anchorRow), rotated so its door faces `facing`'s road — the SAME stamp
 *  trees use, no special building drawer. Returns the number of cells placed (0 if the composition for the
 *  (type,length) isn't in the loaded tileset). */
export function stampBuildingComposition(grid: IsometricGrid, type: BuildingType, length: number, anchorCol: number, anchorRow: number, zone: ZoneId, facing: Facing, material?: string, roofColor?: string, wallColor?: string): number {
  return stampComposition(grid, buildingCompositionKind(type, length), anchorCol, anchorRow, zone, 0, facingRotation(facing), material, roofColor, wallColor)
}
