/**
 * CELL STACK, the "one tile-stack model" projection over a cell's assets.
 *
 * MODEL: a cell is a fixed slot; everything in it is a uniform TILE with Width/Depth/HEIGHT (h:0 = a flat
 * slab like a floor/road, ≥1 = an extruded block). A cell holds an ORDERED stack, index 0 = the base tile.
 * There is NO separate ground store: the floor/road is a plain `type:'floor'` GridAsset at heightLevel 0
 * (a thin coloured slab) living in `assets[]` exactly like every wall/prop, so the whole stack is just
 * `assets[]` sorted by heightLevel. (Terrain `height[row][col]` is a CELL elevation prop, NOT a tile.)
 *
 * `getStack` projects a cell's assets onto `TileEntry[]`; the mutators (pushTile/popTile) translate stack
 * ops back onto the grid. Pure + unit-tested.
 */
import { styleCatalog, styleTile, styleTiles } from '@/engine/tileset/styleTiles'
import { FLOOR_TYPE, DEFAULT_FLOOR_SLUG, type IsometricGrid, type GridAsset } from './IsometricGrid'
import type { TilePose } from './tileset/pose'
import { resolveTileHeight } from './tileset/tileHeight'
import { depthCells } from './render/isoBlock'
import { assetIsSolid } from './collisionBoxes'

/** Which store a TileEntry projects from, lets a consumer/mutator route back to the right setter/store.
 *  There is NO `floor` source: the floor is a plain `type:'floor'` ASSET, so it projects as `asset` exactly
 *  like every wall/window/door/roof/prop block; `entity` = an npc/enemy/player standing on the cell. Everything
 *  is a uniform tile, the source is only how you write BACK, never a branch a picker/inspector takes to READ.
 *  (`building` is retained for legacy round-trips.) */
export type TileSource = 'asset' | 'building' | 'entity'

/** Back-reference from a derived TileEntry to the store row it came from, so selection/edits know which
 *  building block (building B, part, at level L) or which entity a picked tile IS. Floor/asset tiles carry
 *  no ref, they round-trip through the grid's own setters (setFloor / the asset itself). */
export type TileRef =
  | { kind: 'building'; buildingIndex: number; part: 'wall' | 'window' | 'door' | 'roof'; col: number; row: number; level: number }
  | { kind: 'entity'; entityId: string }

/** The minimal shape getStack needs to derive a CHARACTER tile. Structural (not the game `Entity` type) so
 *  the low-level engine layer never imports up into `game/`, the page passes its Entity[] straight in. */
export interface EntityStackTile {
  id: string
  kind: string
  col: number
  row: number
  tileOverride?: string
  color?: string
  blocksMovement?: boolean
}

/** What ELSE (beyond the grid's own ground/assets) is in view for this cell: the entities standing on it.
 *  OPT-IN, omit it and getStack returns exactly the floor+assets stack (byte-identical, the render hot
 *  path reads only the floor and must never pay a per-cell entity scan). Buildings are just their stamped
 *  assets now, so they already flow through the assets list; the pick + inspector pass entities in for the
 *  FULL unified stack. */
export interface StackScope {
  entities?: readonly EntityStackTile[]
}

/**
 * One uniform tile in a cell's stack. The model's atom: everything in a cell, the floor/road AND every
 * stacked prop/block, is a TileEntry projected 1:1 from a GridAsset; the `source`/`heightLevel`/`art`/`type`/
 * `label` carry-throughs let callers map an entry back to its asset.
 */
export interface TileEntry {
  /** style-agnostic Tile Library id pinning this tile's visual (GridAsset.tileOverride). Absent → follows
   *  the active style. */
  tileId?: string
  /** what this tile IS: the ground slug for a floor tile; `label ?? type` for any other asset. */
  slug: string
  /** Width (x), horizontal stretch. GridAsset.scaleX. Absent = tile default (→1). */
  w?: number
  /** Depth (into-screen ground axis). GridAsset.scaleZ. Absent = tile default (→1). */
  d?: number
  /** BLOCK height: 0 = flat slab tile (floor/road), ≥1 = extruded cube. resolveTileHeight(GridAsset.height).
   *  Absent = do NOT pin a per-instance height, the renderer falls back to the tile's catalog height (the
   *  editor brush relies on this so a placed house/tree keeps its authored extrusion). */
  h?: number
  /** Height (up), the per-instance Height MULTIPLIER over the tile's own DB block-height (GridAsset.scaleY,
   *  default 1). The tile's base height is DATA (its DB `height`, a flat tile 0.1); scaleY scales it. Round-trips
   *  through save/load. */
  scaleY?: number
  /** per-instance pose (position/rotation within the cell). GridAsset.pose. */
  pose?: TilePose
  /** colour override (GridAsset.color). null/absent = catalog colour. */
  color?: string | null
  /** per-instance sprite opacity (GridAsset.opacity). absent = fully opaque (the renderer uses `opacity ?? 1`). */
  opacity?: number
  /** does this tile occupy part of its cell (from its collision boxes). See deriveCellCollision. */
  collision?: boolean
  /** which store this entry came from (always `asset` for grid tiles; `entity` for a character). */
  source: TileSource
  /** stack level carried from the asset (GridAsset.heightLevel). A base tile = 0. */
  heightLevel?: number
  /** carry-through of the asset's visual (GridAsset.art). */
  art?: string[]
  /** carry-through of the asset's type (GridAsset.type). */
  type?: string
  /** carry-through of the asset's cell-part label (GridAsset.label). */
  label?: string
  /** back-reference to the store row a DERIVED tile came from (building block / entity). floor+asset
   *  tiles omit it (they write back through the grid's own setters / the asset). */
  ref?: TileRef
}

/** A stacked asset → its uniform TileEntry. Height goes through resolveTileHeight (0-clamped, matches the
 *  iso renderer); blocking → collision; tileOverride → tileId; scaleX/scaleZ/scale → w/d/zoom. A FLOOR is just
 *  an asset whose slug is its ground tileKey (grass/road/…); it stays `source:'asset'` (no `source:'floor'`). */
function assetEntry(a: GridAsset): TileEntry {
  return {
    source: 'asset',
    tileId: a.tileOverride,
    slug: a.type === FLOOR_TYPE ? (a.tileKey ?? DEFAULT_FLOOR_SLUG) : (a.label ?? a.type),
    w: a.width ?? 1,
    d: a.depth ?? 1,
    h: resolveTileHeight(a),
    color: a.color ?? null,
    opacity: a.opacity,
    // WHAT IT OCCUPIES, asked once. `assetIsSolid` reads the tile's collision boxes (per-instance, else its
    // catalog row), which is the only statement about walking through a tile since the flag was removed.
    collision: assetIsSolid(a),
    heightLevel: a.heightLevel ?? 0,
    art: a.art,
    type: a.type,
    label: a.label,
  }
}

/**
 * The cell's tile stack: index 0 = the floor (a level-0 floor asset), then the loose assets sorted by
 * heightLevel. Buildings' wall/window/door/roof blocks are REAL per-cell assets, so they come through this
 * SAME list, no separate floor/building projection to fold in. `_scope` (entities) is accepted for call-site
 * compatibility. ONE uniform TileEntry[] a picker/inspector iterates with NO branch on the kind of tile.
 */
export function getStack(grid: IsometricGrid, col: number, row: number, _scope: StackScope = {}): TileEntry[] {
  return grid.getAssetsAtCell(col, row).map(assetEntry)
}

/** A memoized "which stack slot is this asset" lookup over ONE grid snapshot, the canonical per-tile identity
 *  used by selection/picking. A tile is identified by its cell + its INDEX in that cell's ordered stack
 *  (`getAssetsAtCell` order: index 0 = the base/floor slab, then up), which is exactly the index the inspector's
 *  `selectedTileLevel` addresses, so the render highlight, the pick key, and the inspector all agree on ONE
 *  index per tile. This is what lets two tiles at the SAME level (grass slab + wall block, both level 0) be
 *  selected APART: they are different stack slots. Returns a closure so a per-frame render pays the per-cell
 *  sort ONCE (cached), not once per drawn tile. -1 for an asset not in the grid (defensive). */
export function assetStackIndexer(grid: IsometricGrid): (asset: GridAsset) => number {
  const cache = new Map<string, GridAsset[]>()
  return (asset: GridAsset): number => {
    const key = `${asset.col},${asset.row}`
    let stack = cache.get(key)
    if (!stack) {
      stack = grid.getAssetsAtCell(asset.col, asset.row)
      cache.set(key, stack)
    }
    return stack.indexOf(asset)
  }
}

/** Cell collision in the stack model = ANY tile in the stack occupies part of it. The OR of what the assets
 *  declare through their collision boxes (a floor declares none, so it never blocks unless given some). */
export function deriveCellCollision(stack: TileEntry[]): boolean {
  return stack.some(t => t.collision === true)
}

// ── mutators: translate stack ops back onto the grid's EXISTING setters ──

/** The TOP of what a cell already holds, in blocks, where the next tile lands. ONE rule for EVERY tile
 * : each tile occupies `its level + its own block height`, and the next tile rests on the tallest of
 *  them. The FLOOR is counted like any other tile, a flat floor is 0 blocks tall so it adds nothing and a
 *  wall painted on grass starts on the grid, while RAISING that floor tile lifts whatever is stacked above
 *  it, for free, because the rule reads its height the same way it reads a wall's. 0 on an empty cell.
 *
 *  Height is `resolveTileHeight` × the per-instance Height multiplier (scaleY), the SAME product the iso
 *  renderer extrudes, so a 4-block pier authored as one scaleY-4 cell stacks as 4 blocks, not as 1. */
export function cellStackTop(grid: IsometricGrid, col: number, row: number): number {
  // The lego rule is UNCHANGED: each tile occupies `its level + its own block height`, and the next tile rests
  // on the tallest, height ≥ 1 tiles stack on top, a flat tile adds 0 so content lands at its level.
  // ACT-AS-TILE makes a tile count as an
  // occupant of AT LEAST ONE block for stacking, so content stacks ON TOP of it EVEN WHEN IT IS FLAT (a
  // height-0 road you WALK OVER lifts the walker to level 1 without being raised). Default false → a flat tile
  // still lets content land at its own level. A height-≥1 tile is already ≥1, so this never changes the legos.
  return grid.getAssetsAtCell(col, row).reduce((top, a) => Math.max(top, (a.heightLevel ?? 0) + stackContribution(a)), 0)
}

/** The level a tile the USER just painted lands at: the top of the VOLUME the cell already holds.
 *
 * *"I clicked to add a tile, then clicked again toa dd another tile on top of the 1 one a nothing happened...
 * they should stack indifinately"*. Painting `bush` three times produced three tiles all at level 0, drawn
 * inside one another, because `bush`, `flower` and `blossom` serve `stackAt: 0` and `cellStackTop` scales a
 * tile's height by it, so each contributed nothing and the next paint landed back at the bottom.
 *
 * The difference from `cellStackTop` is WHO IS ASKING, and it is the whole reason both exist:
 *
 *   - A GENERATOR stamping a tree onto a flowered cell is asking where the ground is. A flower is not a
 *     surface, so the tree belongs at its feet. That is `cellStackTop`, that is what `stackAt` is for, and
 *     `stackAt.test.ts` defends it.
 *   - A PERSON clicking a cell that already holds a bush has already said where they want the tile: on top of
 *     it. Nothing is being inferred, so nothing may quietly overrule them, and MAP-MODEL §4's lego law says
 *     the same thing.
 *
 * So this reads `occupiedHeight` alone. A flat floor still occupies nothing and the first paint lands at 0; a
 * walk-over road acts as a tile and occupies 1, so a paint lands on top of it. 0 on an empty cell. */
export function cellPaintTop(grid: IsometricGrid, col: number, row: number): number {
  return grid.getAssetsAtCell(col, row).reduce((top, a) => Math.max(top, (a.heightLevel ?? 0) + occupiedHeight(a)), 0)
}

/** The level a UNIT (hero / npc / enemy) STANDS AT in a cell, the top of the cell's GROUND, NOT the top of
 *  everything in it. A unit is not a tile you stack: walls, doors, windows and roofs are STRUCTURE it passes
 *  through (the cell is walkable) or that blocks the cell outright, never a surface it is lifted onto.
 *
 * Using `cellStackTop` here was the "hero walks in the door and ends up on the roof" bug (
 *  "instead of going inside, it went over the tiles, which is wrong"): a doorway cell holds the whole facade
 *  column above the doorstep, `L0 path_stone | L1 door | L3 wall | L4 window | L5 wall | L6 window | L7 roof`, *  so the stack top was 8 and the hero was drawn eight blocks up, standing on the roof.
 *
 *  RAISING THE GROUND STILL LIFTS THE UNIT: the ground is read through the SAME lego math every tile uses
 *  (`stackContribution`, its level + its own height, act-as-tile counting as ≥1), so a height-1 meadow or a
 *  walk-over road lifts the walker exactly like it lifts a stacked tile. 0 on a cell with no ground. */
export function unitStandLevel(grid: IsometricGrid, col: number, row: number): number {
  return grid.getAssetsAtCell(col, row).reduce((top, a) => {
    // A FLOOR, OR ANYTHING THAT SAYS IT IS A SURFACE. `actAsTile` means "this cell behaves as if a tile were
    // already in it, so the next thing stacks on top", which is exactly what a walk-over surface is, and a
    // unit is the next thing. Reading it here is what lets a BRIDGE DECK hold the hero up: a deck is a
    // composition cell, not a floor, so the old floors-only test scored it 0 and the hero walked under the
    // bridge instead of over it.
    //
    // Structure stays excluded, which is the rule this function exists for: a wall, a door, a window and a
    // roof are things a unit passes through or is blocked by, never lifted onto, and none of them claims to
    // act as a tile. So the doorway case it was written for is untouched.
    if (a.type !== FLOOR_TYPE && !assetActsAsTile(a)) return top
    return Math.max(top, (a.heightLevel ?? 0) + stackContribution(a))
  }, 0)
}

/** How many blocks a tile OCCUPIES, its own block height, but AT LEAST 1 when it acts as a tile so content
 *  stacks on top of it (a flat walk-over surface still lifts what stands on it). Non-act-as-tile → its plain
 *  height, so the lego model is byte-identical.
 *
 *  This is the volume question ("how much of the cell is full"), kept apart from the surface question
 *  (`assetStackAt`, "where in that volume does the next thing stand"), because the two have different answers
 *  for a bush and different callers need different ones. */
function occupiedHeight(a: GridAsset): number {
  return assetActsAsTile(a) ? Math.max(1, assetBlocks(a)) : assetBlocks(a)
}

/** How many blocks a tile contributes to the SURFACE the next thing rests on: what it occupies, scaled by
 *  where in itself it holds that thing up. A bush is a block of volume that holds nothing up at all. */
function stackContribution(a: GridAsset): number {
  return occupiedHeight(a) * assetStackAt(a)
}

/**
 * WHERE IN THE CELL the next thing stands: 1 is this tile's TOP face (the default, and what every tile did
 * before this existed), 0 is its BOTTOM face, and anything between is a fraction of its height.
 *
 * It also guessed the cause exactly. A cell stacks by each tile's own HEIGHT, and `flower`, `clover`, `wheat`
 * and `bush` are all authored a full block tall in the live catalog so they draw as standing billboards. That
 * same block was then counted as a SURFACE, so a tree stamped onto a flowered cell started one level up. How
 * tall a thing DRAWS and whether you can stand on it are two different questions, and they shared one number.
 *
 * Read the SAME data path as height and act-as-tile: a per-instance override wins, else the DB tile's own
 * `settings.stackAt`, else 1. Clamped, because a negative would sink the stack into the floor.
 */
function assetStackAt(a: GridAsset): number {
  const perInstance = (a.settings as { stackAt?: number } | undefined)?.stackAt
  const slug = a.type === FLOOR_TYPE ? (a.tileKey ?? DEFAULT_FLOOR_SLUG) : (a.label ?? a.type)
  const tile = styleTile('ascii', slug) ?? styleTile('emoji', slug)
  const served = (tile?.settings as { stackAt?: number } | undefined)?.stackAt
  const value = perInstance ?? served
  return typeof value === 'number' && value >= 0 && value <= 1 ? value : 1
}

/** Does this placed tile ACT AS A TILE, i.e. "does the cell behave as if a tile was already inside it", so the
 *  next tile stacks ON TOP rather than landing inside at level 0? A per-tile SETTING (`settings.actAsTile`),
 *  read the SAME data path as height: a per-instance/composition-cell override on the asset wins, else the DB
 *  tile's own `settings.actAsTile`. Resolved by the tile's slug (floor → its ground kind, like assetBlocks).
 *
 * OPT-IN. It was default-TRUE. While every ground was a height-1 cube that
 *  default was a NO-OP: `max(1, blocks)` and `blocks` are the same number when blocks is already 1. It only
 *  started doing anything when T-140 made the ground FLAT, and what it then did was fabricate a block of
 *  vertical space that NOTHING DRAWS: the floor skin is painted at level 0, the building was stamped at level 1,
 * and the house parted company with its own floor.
 *
 *  The 2026-07-26 GOAL still holds and is still met: on a FLAT ground tile, level 0 *is* on top of it, there is
 * no interior to sink into. So the lego law it stated governs unchanged (), and act_as_tile goes back to being what
  * it first
 *  described it as, the explicit switch for a walk-over surface (a height-0 road that should still lift what
 *  stands on it), set on the TILE in the backend like every other setting. No tile in the live DB sets it today. */
/**
 * A TILE SETTING AS THIS ASSET ACTUALLY SEES IT: its own per-instance value, else the value its DB tile
 * serves. One resolution for every setting, which is the rule: every setting reaches every tile through the
 * same path, and a setting only some tiles can see is a bug.
 *
 * This existed privately for `actAsTile` and `stackAt` and nowhere else, so `display` and `transparent` were
 * read straight off `asset.settings` in all three renderers. A GENERATED prop pins no per-instance settings
 * (it renders at its catalog values), so a rock seeded `display: single` in the backend still drew as a solid
 * cube of rock: the served setting was never consulted. Painting one by hand worked, which is what made it
 * look like the data was wrong rather than the read.
 */
export function assetSetting<T>(a: GridAsset, key: string): T | undefined {
  const perInstance = (a.settings as Record<string, unknown> | undefined)?.[key]
  if (perInstance !== undefined) return perInstance as T
  const slug = a.type === FLOOR_TYPE ? (a.tileKey ?? DEFAULT_FLOOR_SLUG) : (a.label ?? a.type)
  const tile = styleTile('ascii', slug) ?? styleTile('emoji', slug)
  return (tile?.settings as Record<string, unknown> | undefined)?.[key] as T | undefined
}

/** Is this asset drawn as ONE centred tile rather than as a cube with its picture on every face? */
export const assetDrawsSingle = (a: GridAsset): boolean => assetSetting<string>(a, 'display') === 'single'

/** Does this asset skip the coloured block shell entirely, leaving only its own picture (a flower, a rock)? */
export const assetIsTransparent = (a: GridAsset): boolean => assetSetting<boolean>(a, 'transparent') === true

function assetActsAsTile(a: GridAsset): boolean {
  return assetSetting<boolean>(a, 'actAsTile') === true
}

/** A placed tile's own height in BLOCKS: its per-instance override, else its DB tile's height, × the
 *  per-instance Height multiplier (scaleY), the same product the iso renderer extrudes. The DB read matters:
 *  a GENERATED asset usually pins no per-instance height (it renders at its catalog height), so reading the
 *  instance alone would treat a standing tree as 0 blocks and bury the next tile inside it. Heights are
 *  style-identical, the SAME label carries the SAME height in ascii and emoji (MAP-MODEL §4), so whichever
 *  tileset holds the label answers. */
function assetBlocks(a: GridAsset): number {
  const slug = a.type === FLOOR_TYPE ? (a.tileKey ?? DEFAULT_FLOOR_SLUG) : (a.label ?? a.type)
  return resolveTileHeight(a)
}

/** pushTile → STACK a tile onto the cell (MAP-MODEL §4 "a cell holds an ORDERED stack ... stacked like legos"):
 *  placeAsset at heightLevel = `stackTop`, the top of everything already in the cell, floor included, so the
 *  tile rests ON what is there. The floor STAYS: paint a wall on grass and the grass tile remains beneath as
 *  its own stacked tile (a flat floor is 0 blocks, so the wall starts on the grid); a roof/upper level stacks
 *  ABOVE by its own height. The floor is removed ONLY by an
 *  explicit CLEAR/erase (grid.removeFloor via clearGroundTile), never by placement. placeAsset's fixed option
 *  list drops the per-instance dims (scaleX/scaleZ/scaleY/height) and the label, so we assign those onto the
 *  just-placed asset to keep the uniform-tile push lossless. Each patch is applied ONLY when the entry actually
 *  pins that field: an entry that OMITS w/d/h (the editor brush, which places a tile at its catalog size/height)
 *  leaves scaleX/scaleZ/height undefined so the renderer falls back to the tile default. Returns the placed
 *  GridAsset. */
export function pushTile(grid: IsometricGrid, col: number, row: number, entry: TileEntry): GridAsset {
  const heightLevel = cellPaintTop(grid, col, row)
  grid.placeAsset(entry.art ?? [], col, row, {
    type: entry.type,
    color: entry.color ?? undefined,
    opacity: entry.opacity,
    tileOverride: entry.tileId,
    heightLevel,
  })
  const placed = grid.assets[grid.assets.length - 1]
  if (entry.w !== undefined) placed.width = entry.w
  if (entry.d !== undefined) placed.depth = entry.d
  if (entry.h !== undefined) placed.height = entry.h
  if (entry.label !== undefined) placed.label = entry.label
  return placed
}

/** The cell's tiles in the order the INSPECTOR indexes them (ascending heightLevel), the order a per-tile
 *  edit's `stackIndex` addresses, so slot N here is the tile the user actually selected. */
function orderedStack(grid: IsometricGrid, col: number, row: number): GridAsset[] {
  return [...grid.getAssetsAtCell(col, row)].sort((a, b) => (a.heightLevel ?? 0) - (b.heightLevel ?? 0))
}

/** Set a stacked tile's own BLOCK height and LIFT everything above it in the cell by the change, "ALL TILES
 *  STACK ON TOP OF ANOTHER LIKE LEGOS BY DEFAULT … IF INCREASE THE HEIGHT OF ANY FLOOR TILE, WHATEVER IS ON
 *  TOP OF IT WILL GET LIFTED, BECAUSE THAT'S HOW ALL FUCKING TILES WORK AND THE FLOOR IS NO DIFFERENT FROM IT"
 * . It applies to EVERY tile, floor included, there is no floor case in here.
 *
 *  The lift is written into STATE (the tiles above get new heightLevels), never derived at draw time. A level
 *  is where the tile was PUT: 32 real composition cells deliberately float clear of whatever is under them (a
 *  tree's leaves beside its trunk, a lamp's bulb, a store sign, an office rooftop unit), so re-seating each
 *  tile onto the one below would collapse every tree and lamp on the map. Shifting the whole pile by the SAME
 *  delta raises it while preserving those authored gaps. A shrink shifts back down, so the edit is reversible.
 *
 *  `blocks` becomes the tile's ONE height number, it lands on `height` and clears any per-instance `scaleY`
 *  multiplier, so a collapsed composition run (height 1 × scaleY 4) edited to 5 is simply 5 blocks tall. */
export function setTileHeight(grid: IsometricGrid, col: number, row: number, stackIndex: number, blocks: number): void {
  const target = orderedStack(grid, col, row)[stackIndex]
  if (!target) return

  // Measured in STACKING blocks, not raw height, the two differ for a flat tile that acts as one. A floor is
  // flat now (height 0) while `act_as_tile` still makes it occupy one block for stacking, which is what puts
  // content on the slab's top at level 1. Taking the delta from the raw height would count that first block
  // twice: raising a flat floor to 5 would lift what stands on it by 5 rather than by 4, and the house would
  // part company with its own floor. `stackContribution` is what decided where the content sits, so it is what
  // has to decide how far it moves.
  const before = stackContribution(target)
  target.height = blocks
  const delta = stackContribution(target) - before
  if (delta === 0) return

  // Everything standing ON the tile rises: any OTHER tile that shares a block with it and starts at or above
  // where its top USED to be. Both halves matter, see occupiedBlocks.
  const footprint = new Set(occupiedBlocks(target).map(blockKey))
  const wasTop = (target.heightLevel ?? 0) + before // same measure as the delta, so the two can never disagree
  const targetOrder = grid.assets.indexOf(target)

  for (let i = 0; i < grid.assets.length; i++) {
    const other = grid.assets[i]
    if (other === target) continue
    const level = other.heightLevel ?? 0
    // ON TOP = starts at or above where this tile's top USED to be. A tile of 0 blocks makes everything share
    // its level, so ties are broken by the cell's stack ORDER: a tile added later rests on one added earlier.
    // That is what keeps the GROUND out of it, the floor is the first thing in a cell, so a block standing on
    // it can never carry it upward, no matter how flat the block is. (No floor branch: it falls out of order.)
    if (level < wasTop || (level === wasTop && i < targetOrder)) continue
    if (occupiedBlocks(other).some(b => footprint.has(blockKey(b)))) other.heightLevel = level + delta
  }
  // The levels above just moved, so every cached per-cell stack ORDER is stale, and the stack slots the
  // renderer records for picking are built from it. Without this the inspector keeps editing the slot the
  // tile USED to occupy, so the next height change lands on the wrong tile.
  grid.assetLevelsChanged()
}

/** Toggle a stacked tile's ACT-AS-TILE setting (`settings.actAsTile`) and LIFT what stands on it by the change
 *  in its stacking occupancy, act_as_tile makes the tile count as ≥1 block for stacking, so a FLAT tile that
 *  starts acting as a tile lifts content ON TOP of it (a walk-over road/floor). Mirrors setTileHeight's lift
 *  (the shared "raising a tile lifts what's on it" rule); a height-≥1 tile already counts ≥1 so nothing moves. */
export function setCellActAsTile(grid: IsometricGrid, col: number, row: number, stackIndex: number, on: boolean): void {
  const target = orderedStack(grid, col, row)[stackIndex]
  if (!target) return
  const before = stackContribution(target)
  target.settings = { ...(target.settings ?? {}), actAsTile: on }
  const delta = stackContribution(target) - before
  if (delta === 0) return
  const footprint = new Set(occupiedBlocks(target).map(blockKey))
  const wasTop = (target.heightLevel ?? 0) + before
  const targetOrder = grid.assets.indexOf(target)
  for (let i = 0; i < grid.assets.length; i++) {
    const other = grid.assets[i]
    if (other === target) continue
    const level = other.heightLevel ?? 0
    if (level < wasTop || (level === wasTop && i < targetOrder)) continue
    if (occupiedBlocks(other).some(b => footprint.has(blockKey(b)))) other.heightLevel = level + delta
  }
  grid.assetLevelsChanged()
}

const blockKey = (b: { col: number; row: number }): string => `${b.col},${b.row}`

/** Every block a tile OCCUPIES: its anchor, plus the blocks its Z-WIDTH spans.
 *
 *  "even if it's 1 tile positioned in 1 block with smart z-width, it's still ocupying the other blocks, just
 * differently". A z-width road or roof bar is ONE tile lying ACROSS several blocks, so a lift has to consider all of
  * them, both directions: - raise the spanning tile → everything standing on ANY block it covers goes up (its anchor
  * is not special); - raise a tile under one of those blocks → the spanning tile goes up, even though it is anchored
  * elsewhere.
 *  A tile with no z-width simply occupies its own block, so the ordinary case is unchanged. */
function occupiedBlocks(a: GridAsset): { col: number; row: number }[] {
  const depth = a.spanForward ?? 1
  if (depth > 1 && a.spanAxis) return depthCells(a.col, a.row, depth, a.spanAxis)
  return [{ col: a.col, row: a.row }]
}

/** popTile → remove the TOP STACKED asset (highest heightLevel, excluding the floor) at the cell. Returns the
 *  removed asset, or undefined when the cell holds no stacked tile (only its floor, or empty), the floor is
 *  never popped here (clear it via removeFloor). Cell collision is recomputed by the caller (removeTopAsset). */
export function popTile(grid: IsometricGrid, col: number, row: number): GridAsset | undefined {
  const stacked = grid.getAssetsAtCell(col, row).filter(a => a.type !== FLOOR_TYPE)
  if (stacked.length === 0) return undefined
  const top = stacked[stacked.length - 1] // highest-level non-floor tile
  grid.removeAssetsWhere(a => a === top)
  return top
}

/** setTileCollision → setCollision. The legacy collision setter is cell-level, so this translates the
 *  stack's "does this cell block" flag straight onto grid.collision[row][col]. */
export function setTileCollision(grid: IsometricGrid, col: number, row: number, solid: boolean): void {
  grid.setCollision(col, row, solid)
}
