// LIVE stamp for a multi-cell COMPOSITION (tree / bush / house / store …), the data-driven, ALL-asset
// path every pre-built asset uses. Reads the composition (footprint + per-cell tile) from the LOADED DB
// tileset and places one labeled per-cell asset per cell; each cell's glyph + colour come from resolveTile
// (DB), its collision from the cell's `walkable` flag, its stack from `level`. The three views then draw
// each cell through the generic per-cell path (drawIsoLabeledCell / draw2DLabeledCell / the birdseye
// per-cell pass), NO per-type drawer. A pre-built BUILDING is stamped through THIS exact path (rotated to
// face its road), not a special building unit, that is how "everything is a collection of backend tiles"
// is enforced.
import { styleCatalog } from '@/engine/tileset/styleTiles'
import { resolveComposition, resolveTile, tileRenderBehavior, tileThicknessReach } from '@/engine/tileset/tileset'
import type { Composition, CompositionCell, ResolvedTile } from '@/engine/tileset/tileset'
import type { GridAsset, IsometricGrid } from '@/engine/IsometricGrid'
import { cellStackTop } from '@/engine/cellStack'
import type { ZoneId } from '@/engine/zones'
import type { BuildingType } from '@/engine/buildingTypes'
import type { Facing } from '@/engine/villageLayout'
import { buildingCompositionKind, facingRotation, rotateFootprintOffset } from '@/engine/buildingCatalog'
import { rotateDepthDir, rotateThicknessReach, type IsoDiagonal, type ThicknessReach } from '@/engine/render/isoBlock'

// Apex-signage colour for a titled building, a single readable signage tone drawn on drawApexBadge's
// dark backing. The building NAME is the DATA (the composition's `title`); the colour is a fixed render
// constant (the old per-type gold/white marquee collapses now that only the name is data).
const BADGE_COLOR = '#ffffff'

/** Stamp composition `kind` at anchor (col,row). Returns the number of cells placed (0 if the kind has no
 *  composition in the loaded tileset). `variant` picks the per-cell canopy shade (a tree's green/brown tone).
 *  `rotation` (CW quarter-turns) rotates the footprint around its anchor so a building can face its road;
 *  trees/props leave it 0 (unrotated). The anchor stays the footprint's origin/top-left after rotation. */
// One wall MATERIAL is chosen per BUILDING at generation and rewritten onto its wall pieces here, so the
// composition stays SHAPE-only (a building never mixes materials; variety is BETWEEN buildings). Rewrites
// ONLY `wall_<material>_<pos>` cells, roofs/windows/doors/signage keep their own labels. `material` is a
// wall base like "wall_stone"; absent → the composition's authored material stands (store/hospital/civic).
const WALL_MAT = /^wall_(stone|brick|wood|plaster)_/

// A cell's COLOUR is a per-tile SETTING (TILESET-AUTHORING §1, TILE-BACKEND-MIGRATION §5), the engine
// FILTERS the baked tile to it at draw time (render/shared.ts tintedImage, luminance-mapped). The generator
// can therefore override a building's ROOF / WALL colour without touching the composition SHAPE. A ROOF cell
// is the whole roof volume: the gable body/cap (`roof*`, also catches `rooftop_unit`), plus the flat-roof
// deck (`flat_roof`) and its parapet lip (`parapet`), which don't start with "roof". A WALL cell is any
// `wall_*` material piece. Windows / doors / awnings / storefront glass keep their OWN colour. An absent
// override → the tile's authored colour stands, so a colour-less stamp is byte-identical to before.
const isRoofLabel = (label: string): boolean => label.startsWith('roof') || label === 'flat_roof' || label === 'parapet'

/**
 * THE RESIDENTIAL ROOFS A PALETTE MAY SWAP BETWEEN, and the cap each one wears.
 *
 * A roof is two tiles: the body and the ridge cap above it. `house_4` is `roof` + `roof_top`, `house_5` is
 * `roof_slate` + `roof_top_slate`. Swapping only the body would leave a gable ridge sitting on a flat deck,
 * so the cap moves with it, and a FLAT roof has no ridge at all (the one flat-roofed composition in the
 * catalog pairs its deck with a store lip, not a gable cap), so that cell is dropped instead of substituted.
 *
 * `roof_store` and `roof_hospital` are absent on purpose: those two buildings keep their identity, the same
 * rule that already stops them picking a wall material from the palette.
 */
const ROOF_CAPS: Readonly<Record<string, string | null>> = {
  roof: 'roof_top',
  roof_slate: 'roof_top_slate',
  flat_roof: null,
}

/**
 * What a roof cell's label becomes when the generator's palette names a roof.
 *
 * `undefined` leaves the cell exactly as authored (nothing served, an unknown target, or a fixed-identity
 * roof). A string is the label to lay. `null` means this cell is not laid at all, which is how a flat deck
 * loses the ridge the composition drew.
 */
export function roofSwap(label: string, roofTile: string | undefined): string | null | undefined {
  if (!roofTile || !(roofTile in ROOF_CAPS)) return undefined
  if (label in ROOF_CAPS) return roofTile
  const caps = Object.values(ROOF_CAPS).filter((cap): cap is string => cap !== null)
  if (!caps.includes(label)) return undefined
  // A CAP ON A FLAT DECK.
  //
  // This returned `null` and the stamp reads `null` as "do not lay this cell at all". But `gable_roof` labels
  // the PEAK columns with the cap, so in a flat-roof palette every gabled building lost its ridge columns
  // outright and came out with a hole down the middle of its deck. The ridge has no meaning on a flat roof,
  // the CELL very much does: it becomes deck, and `flattenedRoof` below takes its pitch away.
  return ROOF_CAPS[roofTile] ?? roofTile
}

/**
 * Is this cell a pitched roof being laid FLAT?
 *
 * A gable is authored as one block per column at its own gable-step height (`scaleY` 1 to 3, the triangular
 * silhouette). Swapping the label alone leaves those steps standing, so a "flat" deck came out a stepped
 * mound. On a flat deck the pitch is meaningless and the run collapses to a single block.
 */
export function flattenedRoof(label: string, roofTile: string | undefined): boolean {
  if (roofTile !== 'flat_roof') return false
  return label in ROOF_CAPS || Object.values(ROOF_CAPS).includes(label)
}
/**
 * Is this cell a WALL, so the place's wall colour applies to it?
 *
 * A plain wall is the solid `wall` block with
 * the colour doing all the work, the same trick the meadow's floor uses. That label has no underscore, so
 * `startsWith('wall_')` said it was not a wall and the palette's colour skipped it: a modern block of flats
 * would have come out in the tile's own seasonal tone instead of the city's.
 */
const isWallLabel = (label: string): boolean => label === 'wall' || label.startsWith('wall_')

/**
 * IS THIS CELL FOLIAGE? The TILE says so, the frontend does not guess.
 *
 * This tested `label.startsWith('leaf_') || startsWith('canopy_')`, which is the frontend deciding a fact
 * about backend data, and it was wrong by omission the moment the same question was asked of the
 * undergrowth: `thicket` and `shrub` are just as much foliage and match neither prefix. `settings.foliage`
 * is served on the 23 tiles that ARE green foliage and withheld from the ones whose colour is their own (a
 * rock, a flower, autumn litter), so one rule now covers every green thing.
 */
const isFoliage = (tile: { settings?: Record<string, unknown> }): boolean => tile.settings?.foliage === true

/**
 * An axis with the cell's Zoom folded into it.
 *
 * Absent and Zoom 1 stays absent, so a cell that said nothing still carries no opinion and the
 * column's default applies. Anything else becomes a plain number on the axis it belongs to.
 */
const zoomed = (value: number | undefined, zoom: number): number | undefined =>
  zoom === 1 ? value : (value ?? 1) * zoom

/** The per-cell RENDER fields a composition cell contributes to the tile placed in it. */
export type CompositionCellRender = Pick<
  GridAsset,
  'height' | 'heightLevel' | 'zIndex' | 'scaleX' | 'scaleY' | 'depth' | 'thickness' | 'spanForward' | 'spanAxis' | 'spanBack' | 'spanPerp' | 'spanPerpBack' | 'pose' | 'shape' | 'light' | 'settings' | 'animations' | 'placedAt'
>

/** ONE mapping of a composition CELL onto those render fields, shared by the LIVE stamp (stampRun) and the
 *  SAVE path (stageToTemplate), so a generated stage RELOADS exactly as it was stamped. Duplicating this
 *  mapping is what dropped the authored `settings` on save: the 2-wide entrance collapsed back to one block
 *  and the roof's z-width span broke into per-cell blocks on load.
 *
 *  HEIGHT is the TILE's OWN DB height (MAP-MODEL §4, per-tile DATA, read the same way for every tile with no
 *  branch by type/category/art style): a floor tile (the entrance's `path` doorstep) is its flat 0.1 slab, a
 *  standing tile a whole block. A label with no DB tile keeps the unit block, so a stamp never vanishes.
 *  `span` is the collapsed vertical RUN length (1 for a lone cell); `rotation` the building's quarter-turns,
 *  applied to `spanAxis` so a turned building's roof spans the right grid axis. */
// `baseLevel` LIFTS every cell onto the raised FLOOR block it is stamped on (0 for a flat/thin town floor, so
// towns are byte-identical; 1 for a height-1 meadow, so a trunk sits ON TOP of the block instead of embedding
// at level 0). Added to the cell's OWN authored level so the whole composition rises as one, the live callers
// pass the cell's shared stack top (`cellStackTop`), so a composition just lands ON TOP of the floor tile like
// any stacked tile; there is no floor-special lift.
/** Turn a thickness reach map by the building's quarter-turns. Undefined stays undefined, a tile with no
 *  thickness must not acquire one from a rotation. */
function rotateThickness(reach: ThicknessReach | undefined, rotation: number): ThicknessReach | undefined {
  return reach ? rotateThicknessReach(reach, rotation) : undefined
}

export function compositionCellRender(comp: Composition, cell: CompositionCell, tile: ResolvedTile, span: number, rotation: number, baseLevel = 0): CompositionCellRender {
  const cs = cell.settings
  const animated = (cell.animations?.length ?? 0) > 0
  const zoom = cell.scale ?? 1

  return {
    // A placed block is ALWAYS height 1. A tile is pure ART, it does NOT carry height; the GENERATOR/stamp assigns
    // it here when it
    // creates the block. Tallness comes from STACKING cells (a 5-storey building = 5 stacked level-0..4 cells)
    // and `scaleY` (the run-collapse below, and the lamp POST drawn ~7 tall), never from a per-art height. This
    // is why window/leaf/roof/door no longer render flat: they used to copy an art-tile `height: 0`.
    height: 1,
    heightLevel: (cell.level ?? 0) + baseLevel,
    zIndex: cell.zIndex,
    // An AUTHORED per-cell `scaleY` (the lamp POST = one cell drawn ~7 blocks tall) wins; otherwise a
    // collapsed vertical RUN sizes scaleY = span (a wall column of 4 → one block 4 tall). An authored
    // cell is never part of a run, so the two never collide.
    //
    // THE CELL'S ZOOM IS FOLDED IN, not dropped. A trunk and a lamp post are authored thin by scaling
    // every axis at once, and Zoom is gone, so discarding it would draw both at full width. Multiplied
    // into the axes it is the same picture in the primitive that survives: a trunk at Height 3.15 and
    // Zoom 0.6 is Height 1.89, Width 0.6, Depth 0.6.
    //
    // A THIN DOOR is a different thing and is NOT this: thinness inside a full-size cell is the
    // `thickness` reaches below.
    scaleY: zoomed(cs?.scaleY ?? (span > 1 ? span : undefined), zoom),
    scaleX: zoomed(cs?.scaleX, zoom),
    depth: zoomed(undefined, zoom),
    // The thickness AXIS is authored south-facing, exactly like `spanAxis`, ROTATE it by the building's
    // rotation so a house turned a quarter-turn has its doors thin toward ITS front, not the map's.
    thickness: rotateThickness(
      tileThicknessReach((cs ?? undefined) as Record<string, unknown> | undefined)
        ?? tileThicknessReach(tile.settings as Record<string, unknown> | undefined),
      rotation,
    ),
    // Directional DEPTH (roof-z-width / the entrance apron): ONE block spanning `depth` cells along a diagonal.
    // `spanAxis` is authored south-facing, ROTATE it by the building's rotation (the SAME quarter-turns
    // rotateFootprintOffset applied to the cell's offset).
    spanForward: cs?.depth,
    spanAxis: cs?.spanAxis ? rotateDepthDir(cs.spanAxis, rotation) : undefined,
    spanBack: cs?.spanBack, // BIDIRECTIONAL z-width (#58): a composition cell can span BOTH pathways from its anchor
                              // → one roof tile instead of a row (the "optimize tiles usage AGAIN" win)
    spanPerp: cs?.spanPerp, // 2-AXIS z-width ("two sides at the same time"): + the PERPENDICULAR extents, so a
    spanPerpBack: cs?.spanPerpBack, // composition cell covers a RECTANGLE (a 2×2 roof deck authored as 1 tile)
    pose: cs?.pose,
    shape: cs?.shape,
    light: cs?.light,
    settings: cellSettings(comp, cell, tile),
    // A composition cell can ship DEFAULT animations (the fountain water's rise/fade loop), anchored at
    // placedAt 0, the render clock's origin, so a LOAD-triggered loop plays immediately and every fountain
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
  // …AND `transparent`, WHICH IS WHAT DROPS THE CUBE SHELL. It sat on the same cell object as `display`, was
  // served by the backend, and was thrown away here while `display` was copied. Measured on a stamped
  // `forest_entrance`: every cell arrived with `display: 'single'` and nothing else, so the piece kept its
  // coloured box and the tetris piece was never actually fixed, only seeded.
  const transparent = cell.settings?.transparent
  const badge = comp.title && cell.label.startsWith('roof_top') ? { text: comp.title, color: BADGE_COLOR } : undefined
  if (!behavior && !display && !transparent && !badge) return undefined
  return {
    ...behavior,
    ...(display ? { display } : {}),
    ...(transparent ? { transparent } : {}),
    ...(badge ? { badge } : {}),
  }
}

/**
 * WHAT A STAMP MAY OVERRIDE about the composition it places. One object rather than five trailing positional
 * parameters: the call that wanted only `baseAt` had to write `undefined, undefined, undefined, undefined`
 * to reach it, and adding a fourth colour would have made this a fourteen-parameter function.
 *
 * Every field is optional and absent means "use what the composition and its tiles already say".
 */
export interface StampOverrides {
  /** Swap the wall MATERIAL of every wall cell (`wall_stone` for `wall_wood`). */
  material?: string
  /** Recolour just the roof cells. */
  roofColor?: string
  /** Recolour just the wall cells. */
  wallColor?: string
  /**
   * Recolour just the LEAF cells, so one tree is a different green from the next.
   *
   * The generator resolves this per tree from the season, the biome and the region (`foliageColor`) and
   * passes it here as INSTANCE state. The composition template itself still invents no colour, which is the
   * rule every approved object keeps (`OBJECT-CONSTRUCTION.md` §1.1).
   */
  leafColor?: string
  /** Swap the roof TILE (a flat deck for a pitch). `null` cells are dropped rather than substituted. */
  roofTile?: string
  /** Place at this absolute level instead of resting on the cell stack. A bridge SPANS, it does not rest. */
  baseAt?: number
}

export function stampComposition(grid: IsometricGrid, kind: string, anchorCol: number, anchorRow: number, zone: ZoneId, variant = 0, rotation = 0, over: StampOverrides = {}): number {
  const comp = resolveComposition(styleCatalog('ascii'), kind)
  if (!comp) return 0
  // ONE global rule for EVERY composition (building, tree, fountain, lamp): it stacks ON TOP of whatever already
  // fills its anchor cell, the shared cell stack top, so a house lifts onto the height-1 grass exactly like a tree.
  //
  // `baseLevel` is the one exception and it is a different question, not a loophole. Stacking asks what this
  // object RESTS on; a bridge rests on nothing, it SPANS a cut, so where it sits cannot be read from whatever
  // happens to occupy the cell it is anchored in.
  //
  // It was first written as an ADDITION to the stack top and that is the same bug wearing a hat: measured on
  // three woodland seeds, the same bridge landed at levels 4 to 7, 1 to 4 and 0.5 to 3.5, because the anchor
  // cell held a different amount of stuff each time. *"THE MIDDLE SECTION IS STACKING AT THE TOP OF A CELL
  // INSTEAD OF THE BOTTOM, HENCE WHY IT'S NOT ALIGNED WITH THE SIDES THAT CONNECT THE BORDERS"*.
  //
  // So a caller that knows where its object belongs states it OUTRIGHT and the cell stack is not consulted.
  // Everything else passes none and rests exactly as before.
  const baseLevel = over.baseAt ?? cellStackTop(grid, anchorCol, anchorRow)
  const { w, h } = comp.footprint
  // PERF + "intelligent building": collapse each vertical RUN of the SAME tile at a footprint cell
  // into ONE block sized `scaleY = run length`, instead of N stacked unit cubes, a wall column of 4 becomes 1
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
      if (stampRun(grid, comp, kind, cells[i], j - i + 1, anchorCol, anchorRow, w, h, rotation, zone, variant, over, baseLevel)) placed += j - i + 1
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
  over: StampOverrides,
  baseLevel: number,
): boolean {
  const { material, roofColor, wallColor, leafColor, roofTile } = over
  const off = rotation ? rotateFootprintOffset(c.dx, c.dy, w, h, rotation) : { dx: c.dx, dy: c.dy }
  const col = anchorCol + off.dx
  const row = anchorRow + off.dy
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false
  // STACK, don't replace (MAP-MODEL §4 "a cell holds an ORDERED stack ... stacked like legos"): a composition
  // just PLACES its cells; the grass/road floor already in the cell STAYS beneath as its own stacked tile. A
  // LEVEL-0 wall/trunk/rim tile coexists with the floor at level 0 (the floor is a thin ground slab, the wall a
  // block on it); higher levels (roof, upper wall) stack above. The floor is only removed by an explicit CLEAR.
  // THE ROOF the palette named, body and cap together. `null` is a cap a flat deck does not wear, so the cell
  // is not laid at all rather than substituted.
  const roofed = roofSwap(c.label, roofTile)
  if (roofed === null) return false
  // A pitched roof laid FLAT keeps neither its step height nor its extra level, or the deck comes out as a
  // stepped mound with the ridge floating over it (the Image #38).
  const flatten = flattenedRoof(c.label, roofTile)
  const label = roofed ?? (material ? c.label.replace(WALL_MAT, `${material}_`) : c.label)
  const tile = resolveTile(styleCatalog('ascii'), zone, label, variant)
  // Colour SETTING = the filter the renderer tints the baked tile to. A roof/wall material override recolours
  // just those cells; otherwise an AUTHORED per-cell `settings.color` wins (MAP-MODEL §8: "colour is a setting
  // of the tile", e.g. the lamp BULB is a dark lantern by day); absent → the tile's own colour.
  // A LEAF joins the chain the roof and the wall are already on, so a tree takes its map's foliage colour
  // without the renderer learning anything new: it is a tile SETTING either way.
  const color = isRoofLabel(label) && roofColor
    ? roofColor
    : isWallLabel(label) && wallColor
      ? wallColor
      : isFoliage(tile) && leafColor
        ? leafColor
        : c.settings?.color ?? tile.color
  const grounded = (c.level ?? 0) === 0 || undefined
  // The grid's collision map is 2D, one flag per (col,row), so only the composition's GROUND course may write
  // to it. A unit walks at ground level, so that is what the flat map means: a wall at the ground blocks the
  // cell, while a roof or a rooftop unit five levels up must not seal the floor beneath it (a flat-roof shop's
  // crown sits over the middle of its own room and punched a blocked hole in the shop floor). The tile keeps
  // its own truthful `blocking` DATA either way, a roof blocks as a block, nothing stands on it.
  const asset = grid.placeAsset([tile.char], col, row, { type: kind, color, baseShadow: grounded })
  asset.label = label
  // Every render field the cell shapes, its own HEIGHT, stack level, zoom/z-index, scale axes, z-width,
  // pose/shape/light, behavior settings + apex signage, animations, through the ONE shared mapping the SAVE
  // path uses too, so the live stamp and a reloaded save can never diverge.
  Object.assign(asset, compositionCellRender(comp, c, tile, span, rotation, baseLevel))
  // A CELL MAY OVERRIDE WHAT IT OCCUPIES, an open doorway in a wall is the case this exists for. It used to
  // say so with `walkable`, a flag beside the tile; it says so with a box list now, which is the only
  // statement about walking through a tile. Written AFTER the render mapping so it cannot be clobbered by it,
  // and only at the GROUND course, for the reason in the note above: the collision map is 2D, so a roof five
  // levels up must not seal the floor beneath it.
  if (grounded) asset.settings = { ...asset.settings, collision: c.walkable ? [] : [{ x: 0, y: 0, w: 1, h: 1 }] }
  if (grounded && !c.walkable) grid.setCollision(col, row, true)
  if (flatten) {
    asset.scaleY = 1
    asset.heightLevel = (comp.cells.reduce((lowest, x) => (isRoofLabel(x.label) ? Math.min(lowest, x.level ?? 0) : lowest), Infinity) || 0) + baseLevel
  }
  if (!c.walkable && grounded) grid.setCollision(col, row, true) // ground course only, see the note above
  return true
}

/** Stamp a pre-built BUILDING by its explicit composition KIND (`house_4`, `store_5`, `hospital_6`, …) at the
 *  footprint TOP-LEFT (anchorCol,anchorRow), rotated so its door faces `facing`'s road, the SAME stamp trees
 *  use, no special building drawer. Returns the number of cells placed (0 if `kind` isn't in the loaded
 *  tileset). Use this for a GENERATED building: pass its recorded `PlacedBuilding.kind`, which is derived from
 *  the FACADE length at plan time. Re-deriving the kind from a building's grid col-span instead is wrong for an
 *  east/west-facing plot (whose col-span is the DEPTH, not the facade length) and asks for a non-existent
 *  composition (`hospital_4`), stamping 0 cells → a foundation with NO building (the Image #42 orphan). */
export function stampBuildingKind(grid: IsometricGrid, kind: string, anchorCol: number, anchorRow: number, zone: ZoneId, facing: Facing, material?: string, roofColor?: string, wallColor?: string, roofTile?: string): number {
  return stampComposition(grid, kind, anchorCol, anchorRow, zone, 0, facingRotation(facing), { material, roofColor, wallColor, roofTile })
}

/** Stamp a building selected by (type, length), the MANUAL/editor path where `length` IS the facade length
 *  the user picked. For a GENERATED building use {@link stampBuildingKind} with its authoritative `kind` (see
 *  the orphan-foundation note above). Returns the number of cells placed (0 if the (type,length) composition
 *  isn't in the loaded tileset). */
export function stampBuildingComposition(grid: IsometricGrid, type: BuildingType, length: number, anchorCol: number, anchorRow: number, zone: ZoneId, facing: Facing, material?: string, roofColor?: string, wallColor?: string, roofTile?: string): number {
  return stampBuildingKind(grid, buildingCompositionKind(type, length), anchorCol, anchorRow, zone, facing, material, roofColor, wallColor, roofTile)
}
