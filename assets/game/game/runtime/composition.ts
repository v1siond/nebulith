// LIVE stamp for a multi-cell COMPOSITION (tree / bush / house / store …) — the data-driven, ALL-asset
// path every pre-built asset uses. Reads the composition (footprint + per-cell tile) from the LOADED DB
// tileset and places one labeled per-cell asset per cell; each cell's glyph + colour come from resolveTile
// (DB), its collision from the cell's `walkable` flag, its stack from `level`. The three views then draw
// each cell through the generic per-cell path (drawIsoLabeledCell / draw2DLabeledCell / the birdseye
// per-cell pass) — NO per-type drawer. A pre-built BUILDING is stamped through THIS exact path (rotated to
// face its road), not a special building unit — that is how "everything is a collection of backend tiles"
// is enforced.
import { resolveComposition, resolveTile, tileRenderBehavior } from '@/engine/tileset/tileset'
import type { Composition, CompositionCell, ResolvedTile } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import type { GridAsset, IsometricGrid } from '@/engine/IsometricGrid'
import type { ZoneId } from '@/engine/zones'
import type { BuildingType } from '@/engine/buildingTypes'
import type { Facing } from '@/engine/villageLayout'
import { buildingCompositionKind, facingRotation, rotateFootprintOffset } from '@/engine/buildingCatalog'
import { rotateDepthDir } from '@/engine/render/isoBlock'

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

/** The per-cell RENDER fields a composition cell contributes to the tile placed in it. */
export type CompositionCellRender = Pick<
  GridAsset,
  'height' | 'heightLevel' | 'scale' | 'zIndex' | 'scaleX' | 'scaleY' | 'scaleZ' | 'depth' | 'depthDir' | 'pose' | 'shape' | 'light' | 'settings' | 'animations' | 'placedAt'
>

/** ONE mapping of a composition CELL onto those render fields — shared by the LIVE stamp (stampRun) and the
 *  SAVE path (stageToTemplate), so a generated stage RELOADS exactly as it was stamped. Duplicating this
 *  mapping is what dropped the authored `settings` on save: the 2-wide entrance collapsed back to one block
 *  and the roof's z-width span broke into per-cell blocks on load.
 *
 *  HEIGHT is the TILE's OWN DB height (MAP-MODEL §4 — per-tile DATA, read the same way for every tile with no
 *  branch by type/category/art style): a floor tile (the entrance's `path` doorstep) is its flat 0.1 slab, a
 *  standing tile a whole block. A label with no DB tile keeps the unit block, so a stamp never vanishes.
 *  `span` is the collapsed vertical RUN length (1 for a lone cell); `rotation` the building's quarter-turns,
 *  applied to `depthDir` so a turned building's roof spans the right grid axis. */
export function compositionCellRender(comp: Composition, cell: CompositionCell, tile: ResolvedTile, span: number, rotation: number): CompositionCellRender {
  const cs = cell.settings
  const animated = (cell.animations?.length ?? 0) > 0
  return {
    height: tile.height ?? 1,
    heightLevel: cell.level ?? 0,
    scale: cell.scale ?? 1,
    zIndex: cell.zIndex,
    // An AUTHORED per-cell `scaleY` (the lamp POST = one cell drawn ~7 blocks tall) wins; otherwise a collapsed
    // vertical RUN sizes scaleY = span (a wall column of 4 → one block 4 tall). An authored cell is never part
    // of a run, so the two never collide.
    scaleY: cs?.scaleY ?? (span > 1 ? span : undefined),
    // WIDTH + DEPTH: a cell can ship a THIN or WIDE tile independent of the uniform Zoom (a tree's trunk width).
    scaleX: cs?.scaleX,
    scaleZ: cs?.scaleZ,
    // Directional DEPTH (roof-z-width / the entrance apron): ONE block spanning `depth` cells along a diagonal.
    // `depthDir` is authored south-facing — ROTATE it by the building's rotation (the SAME quarter-turns
    // rotateFootprintOffset applied to the cell's offset).
    depth: cs?.depth,
    depthDir: cs?.depthDir ? rotateDepthDir(cs.depthDir, rotation) : undefined,
    pose: cs?.pose,
    shape: cs?.shape,
    light: cs?.light,
    settings: cellSettings(comp, cell, tile),
    // A composition cell can ship DEFAULT animations (the fountain water's rise/fade loop), anchored at
    // placedAt 0 — the render clock's origin, so a LOAD-triggered loop plays immediately and every fountain
    // stays in sync (an epoch timestamp would read as "far future" → never start).
    animations: animated ? cell.animations : undefined,
    placedAt: animated ? 0 : undefined,
  }
}

/** The cell's render SETTINGS: the tile's own generic behavior (fadeNear/cutawayRoof), plus a cell-pinned
 *  `display` ('single' → ONE centered billboard, the lamp BULB), plus the apex SIGNAGE a titled composition
 *  (store/hospital) draws on its roof apex. Undefined when the cell opts into none. */
function cellSettings(comp: Composition, cell: CompositionCell, tile: ResolvedTile): GridAsset['settings'] {
  const behavior = tileRenderBehavior(tile.settings)
  const display = cell.settings?.display
  const badge = comp.title && cell.label.startsWith('roof_top') ? { text: comp.title, color: BADGE_COLOR } : undefined
  if (!behavior && !display && !badge) return undefined
  return { ...behavior, ...(display ? { display } : {}), ...(badge ? { badge } : {}) }
}

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
  c: CompositionCell,
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
  // STACK, don't replace (MAP-MODEL §4 "a cell holds an ORDERED stack ... stacked like legos"): a composition
  // just PLACES its cells; the grass/road floor already in the cell STAYS beneath as its own stacked tile. A
  // LEVEL-0 wall/trunk/rim tile coexists with the floor at level 0 (the floor is a thin ground slab, the wall a
  // block on it); higher levels (roof, upper wall) stack above. The floor is only removed by an explicit CLEAR.
  const label = material ? c.label.replace(WALL_MAT, `${material}_`) : c.label
  const tile = resolveTile(ASCII_TILESET, zone, label, variant)
  // Colour SETTING = the filter the renderer tints the baked tile to. A roof/wall override recolours just
  // those cells; every other cell (and any absent override) keeps the tile's own colour.
  const color = isRoofLabel(label) && roofColor ? roofColor : isWallLabel(label) && wallColor ? wallColor : tile.color
  const grounded = (c.level ?? 0) === 0 || undefined
  const asset = grid.placeAsset([tile.char], col, row, { type: kind, blocking: !c.walkable, color, baseShadow: grounded })
  asset.label = label
  // Every render field the cell shapes — its own HEIGHT, stack level, zoom/z-index, scale axes, z-width,
  // pose/shape/light, behavior settings + apex signage, animations — through the ONE shared mapping the SAVE
  // path uses too, so the live stamp and a reloaded save can never diverge.
  Object.assign(asset, compositionCellRender(comp, c, tile, span, rotation))
  if (!c.walkable) grid.setCollision(col, row, true)
  return true
}

/** Stamp a pre-built BUILDING by its explicit composition KIND (`house_4`, `store_5`, `hospital_6`, …) at the
 *  footprint TOP-LEFT (anchorCol,anchorRow), rotated so its door faces `facing`'s road — the SAME stamp trees
 *  use, no special building drawer. Returns the number of cells placed (0 if `kind` isn't in the loaded
 *  tileset). Use this for a GENERATED building: pass its recorded `PlacedBuilding.kind`, which is derived from
 *  the FACADE length at plan time. Re-deriving the kind from a building's grid col-span instead is wrong for an
 *  east/west-facing plot (whose col-span is the DEPTH, not the facade length) and asks for a non-existent
 *  composition (`hospital_4`), stamping 0 cells → a foundation with NO building (the Image #42 orphan). */
export function stampBuildingKind(grid: IsometricGrid, kind: string, anchorCol: number, anchorRow: number, zone: ZoneId, facing: Facing, material?: string, roofColor?: string, wallColor?: string): number {
  return stampComposition(grid, kind, anchorCol, anchorRow, zone, 0, facingRotation(facing), material, roofColor, wallColor)
}

/** Stamp a building selected by (type, length) — the MANUAL/editor path where `length` IS the facade length
 *  the user picked. For a GENERATED building use {@link stampBuildingKind} with its authoritative `kind` (see
 *  the orphan-foundation note above). Returns the number of cells placed (0 if the (type,length) composition
 *  isn't in the loaded tileset). */
export function stampBuildingComposition(grid: IsometricGrid, type: BuildingType, length: number, anchorCol: number, anchorRow: number, zone: ZoneId, facing: Facing, material?: string, roofColor?: string, wallColor?: string): number {
  return stampBuildingKind(grid, buildingCompositionKind(type, length), anchorCol, anchorRow, zone, facing, material, roofColor, wallColor)
}
