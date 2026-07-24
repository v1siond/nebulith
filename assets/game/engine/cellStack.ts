/**
 * CELL STACK — the "one tile-stack model" projection over a cell's assets.
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
import { FLOOR_TYPE, DEFAULT_FLOOR_SLUG, type IsometricGrid, type GridAsset } from './IsometricGrid'
import type { TilePose } from './tileset/pose'
import { resolveTileHeight } from './tileset/tileHeight'
import { ASCII_TILESET } from './tileset/asciiTileset'
import { EMOJI_TILESET } from './tileset/emojiTileset'
import { depthCells } from './render/isoBlock'

/** Which store a TileEntry projects from — lets a consumer/mutator route back to the right setter/store.
 *  There is NO `floor` source: the floor is a plain `type:'floor'` ASSET, so it projects as `asset` exactly
 *  like every wall/window/door/roof/prop block; `entity` = an npc/enemy/player standing on the cell. Everything
 *  is a uniform tile — the source is only how you write BACK, never a branch a picker/inspector takes to READ.
 *  (`building` is retained for legacy round-trips.) */
export type TileSource = 'asset' | 'building' | 'entity'

/** Back-reference from a derived TileEntry to the store row it came from, so selection/edits know which
 *  building block (building B, part, at level L) or which entity a picked tile IS. Floor/asset tiles carry
 *  no ref — they round-trip through the grid's own setters (setFloor / the asset itself). */
export type TileRef =
  | { kind: 'building'; buildingIndex: number; part: 'wall' | 'window' | 'door' | 'roof'; col: number; row: number; level: number }
  | { kind: 'entity'; entityId: string }

/** The minimal shape getStack needs to derive a CHARACTER tile. Structural (not the game `Entity` type) so
 *  the low-level engine layer never imports up into `game/` — the page passes its Entity[] straight in. */
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
 *  OPT-IN — omit it and getStack returns exactly the floor+assets stack (byte-identical — the render hot
 *  path reads only the floor and must never pay a per-cell entity scan). Buildings are just their stamped
 *  assets now, so they already flow through the assets list; the pick + inspector pass entities in for the
 *  FULL unified stack. */
export interface StackScope {
  entities?: readonly EntityStackTile[]
}

/**
 * One uniform tile in a cell's stack. The model's atom: everything in a cell — the floor/road AND every
 * stacked prop/block — is a TileEntry projected 1:1 from a GridAsset; the `source`/`heightLevel`/`art`/`type`/
 * `label` carry-throughs let callers map an entry back to its asset.
 */
export interface TileEntry {
  /** style-agnostic Tile Library id pinning this tile's visual (GridAsset.tileOverride). Absent → follows
   *  the active style. */
  tileId?: string
  /** what this tile IS: the ground slug for a floor tile; `label ?? type` for any other asset. */
  slug: string
  /** Width (x) — horizontal stretch. GridAsset.scaleX. Absent = tile default (→1). */
  w?: number
  /** Depth (into-screen ground axis). GridAsset.scaleZ. Absent = tile default (→1). */
  d?: number
  /** BLOCK height: 0 = flat slab tile (floor/road), ≥1 = extruded cube. resolveTileHeight(GridAsset.height).
   *  Absent = do NOT pin a per-instance height — the renderer falls back to the tile's catalog height (the
   *  editor brush relies on this so a placed house/tree keeps its authored extrusion). */
  h?: number
  /** Zoom — uniform multiplier over every axis. GridAsset.scale. */
  zoom?: number
  /** Height (up) — the per-instance Height MULTIPLIER over the tile's own DB block-height (GridAsset.scaleY,
   *  default 1). The tile's base height is DATA (its DB `height`, a flat tile 0.1); scaleY scales it. Round-trips
   *  through save/load. */
  scaleY?: number
  /** per-instance pose (position/rotation within the cell). GridAsset.pose. */
  pose?: TilePose
  /** colour override (GridAsset.color). null/absent = catalog colour. */
  color?: string | null
  /** per-instance sprite opacity (GridAsset.opacity). absent = fully opaque (the renderer uses `opacity ?? 1`). */
  opacity?: number
  /** does this tile block movement (GridAsset.blocking). See deriveCellCollision. */
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
    w: a.scaleX ?? 1,
    d: a.scaleZ ?? 1,
    h: resolveTileHeight(undefined, a),
    zoom: a.scale,
    scaleY: a.scaleY,
    color: a.color ?? null,
    opacity: a.opacity,
    collision: a.blocking ?? false,
    heightLevel: a.heightLevel ?? 0,
    art: a.art,
    type: a.type,
    label: a.label,
  }
}

/**
 * The cell's tile stack: index 0 = the floor (a level-0 floor asset), then the loose assets sorted by
 * heightLevel. Buildings' wall/window/door/roof blocks are REAL per-cell assets, so they come through this
 * SAME list — no separate floor/building projection to fold in. `_scope` (entities) is accepted for call-site
 * compatibility. ONE uniform TileEntry[] a picker/inspector iterates with NO branch on the kind of tile.
 */
export function getStack(grid: IsometricGrid, col: number, row: number, _scope: StackScope = {}): TileEntry[] {
  return grid.getAssetsAtCell(col, row).map(assetEntry)
}

/** A memoized "which stack slot is this asset" lookup over ONE grid snapshot — the canonical per-tile identity
 *  used by selection/picking. A tile is identified by its cell + its INDEX in that cell's ordered stack
 *  (`getAssetsAtCell` order: index 0 = the base/floor slab, then up), which is exactly the index the inspector's
 *  `selectedTileLevel` addresses — so the render highlight, the pick key, and the inspector all agree on ONE
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

/** Cell collision in the stack model = ANY tile in the stack blocks. The OR of the assets' blocking flags
 *  (a floor tile is blocking:false by default, so it never blocks unless the user opts it in like any tile). */
export function deriveCellCollision(stack: TileEntry[]): boolean {
  return stack.some(t => t.collision === true)
}

// ── mutators: translate stack ops back onto the grid's EXISTING setters ──

/** The TOP of what a cell already holds, in blocks — where the next tile lands. ONE rule for EVERY tile
 *  (Alexander: "ALL TILES STACK ON TOP OF ANOTHER LIKE LEGOS BY DEFAULT … THE FLOOR IS NO DIFFERENT FROM
 *  IT"): each tile occupies `its level + its own block height`, and the next tile rests on the tallest of
 *  them. The FLOOR is counted like any other tile — a flat floor is 0 blocks tall so it adds nothing and a
 *  wall painted on grass starts on the grid, while RAISING that floor tile lifts whatever is stacked above
 *  it, for free, because the rule reads its height the same way it reads a wall's. 0 on an empty cell.
 *
 *  Height is `resolveTileHeight` × the per-instance Height multiplier (scaleY) — the SAME product the iso
 *  renderer extrudes, so a 4-block pier authored as one scaleY-4 cell stacks as 4 blocks, not as 1. */
function stackTop(grid: IsometricGrid, col: number, row: number): number {
  return grid.getAssetsAtCell(col, row).reduce((top, a) => Math.max(top, (a.heightLevel ?? 0) + assetBlocks(a)), 0)
}

/** A placed tile's own height in BLOCKS: its per-instance override, else its DB tile's height, × the
 *  per-instance Height multiplier (scaleY) — the same product the iso renderer extrudes. The DB read matters:
 *  a GENERATED asset usually pins no per-instance height (it renders at its catalog height), so reading the
 *  instance alone would treat a standing tree as 0 blocks and bury the next tile inside it. Heights are
 *  style-identical — the SAME label carries the SAME height in ascii and emoji (MAP-MODEL §4) — so whichever
 *  tileset holds the label answers. */
function assetBlocks(a: GridAsset): number {
  const slug = a.type === FLOOR_TYPE ? (a.tileKey ?? DEFAULT_FLOOR_SLUG) : (a.label ?? a.type)
  return resolveTileHeight(ASCII_TILESET.tiles[slug] ?? EMOJI_TILESET[slug], a) * (a.scaleY ?? 1)
}

/** pushTile → STACK a tile onto the cell (MAP-MODEL §4 "a cell holds an ORDERED stack ... stacked like legos"):
 *  placeAsset at heightLevel = `stackTop` — the top of everything already in the cell, floor included, so the
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
  const heightLevel = stackTop(grid, col, row)
  grid.placeAsset(entry.art ?? [], col, row, {
    type: entry.type,
    blocking: entry.collision ?? false,
    color: entry.color ?? undefined,
    opacity: entry.opacity,
    scale: entry.zoom,
    tileOverride: entry.tileId,
    heightLevel,
  })
  const placed = grid.assets[grid.assets.length - 1]
  if (entry.w !== undefined) placed.scaleX = entry.w
  if (entry.d !== undefined) placed.scaleZ = entry.d
  if (entry.scaleY !== undefined) placed.scaleY = entry.scaleY
  if (entry.h !== undefined) placed.height = entry.h
  if (entry.label !== undefined) placed.label = entry.label
  return placed
}

/** The cell's tiles in the order the INSPECTOR indexes them (ascending heightLevel) — the order a per-tile
 *  edit's `stackIndex` addresses, so slot N here is the tile the user actually selected. */
function orderedStack(grid: IsometricGrid, col: number, row: number): GridAsset[] {
  return [...grid.getAssetsAtCell(col, row)].sort((a, b) => (a.heightLevel ?? 0) - (b.heightLevel ?? 0))
}

/** Set a stacked tile's own BLOCK height and LIFT everything above it in the cell by the change — "ALL TILES
 *  STACK ON TOP OF ANOTHER LIKE LEGOS BY DEFAULT … IF INCREASE THE HEIGHT OF ANY FLOOR TILE, WHATEVER IS ON
 *  TOP OF IT WILL GET LIFTED, BECAUSE THAT'S HOW ALL FUCKING TILES WORK AND THE FLOOR IS NO DIFFERENT FROM IT"
 *  (Alexander). It applies to EVERY tile, floor included — there is no floor case in here.
 *
 *  The lift is written into STATE (the tiles above get new heightLevels), never derived at draw time. A level
 *  is where the tile was PUT: 32 real composition cells deliberately float clear of whatever is under them (a
 *  tree's leaves beside its trunk, a lamp's bulb, a store sign, an office rooftop unit), so re-seating each
 *  tile onto the one below would collapse every tree and lamp on the map. Shifting the whole pile by the SAME
 *  delta raises it while preserving those authored gaps. A shrink shifts back down, so the edit is reversible.
 *
 *  `blocks` becomes the tile's ONE height number — it lands on `height` and clears any per-instance `scaleY`
 *  multiplier, so a collapsed composition run (height 1 × scaleY 4) edited to 5 is simply 5 blocks tall. */
export function setTileHeight(grid: IsometricGrid, col: number, row: number, stackIndex: number, blocks: number): void {
  const target = orderedStack(grid, col, row)[stackIndex]
  if (!target) return

  const before = assetBlocks(target)
  target.height = blocks
  target.scaleY = undefined
  const delta = assetBlocks(target) - before
  if (delta === 0) return

  // Everything standing ON the tile rises: any OTHER tile that shares a block with it and starts at or above
  // where its top USED to be. Both halves matter — see occupiedBlocks.
  const footprint = new Set(occupiedBlocks(target).map(blockKey))
  const wasTop = (target.heightLevel ?? 0) + before

  for (const other of grid.assets) {
    if (other === target || (other.heightLevel ?? 0) < wasTop) continue
    if (occupiedBlocks(other).some(b => footprint.has(blockKey(b)))) {
      other.heightLevel = (other.heightLevel ?? 0) + delta
    }
  }
  // The levels above just moved, so every cached per-cell stack ORDER is stale — and the stack slots the
  // renderer records for picking are built from it. Without this the inspector keeps editing the slot the
  // tile USED to occupy, so the next height change lands on the wrong tile.
  grid.assetLevelsChanged()
}

const blockKey = (b: { col: number; row: number }): string => `${b.col},${b.row}`

/** Every block a tile OCCUPIES: its anchor, plus the blocks its Z-WIDTH spans.
 *
 *  "even if it's 1 tile positioned in 1 block with smart z-width, it's still ocupying the other blocks, just
 *  differently" (Alexander). A z-width road or roof bar is ONE tile lying ACROSS several blocks, so a lift has
 *  to consider all of them — both directions:
 *   - raise the spanning tile → everything standing on ANY block it covers goes up (its anchor is not special);
 *   - raise a tile under one of those blocks → the spanning tile goes up, even though it is anchored elsewhere.
 *  A tile with no z-width simply occupies its own block, so the ordinary case is unchanged. */
function occupiedBlocks(a: GridAsset): { col: number; row: number }[] {
  const depth = a.depth ?? 1
  if (depth > 1 && a.depthDir) return depthCells(a.col, a.row, depth, a.depthDir)
  return [{ col: a.col, row: a.row }]
}

/** popTile → remove the TOP STACKED asset (highest heightLevel, excluding the floor) at the cell. Returns the
 *  removed asset, or undefined when the cell holds no stacked tile (only its floor, or empty) — the floor is
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
export function setTileCollision(grid: IsometricGrid, col: number, row: number, blocking: boolean): void {
  grid.setCollision(col, row, blocking)
}
