/**
 * CELL STACK — the forward-projection adapter for the "one tile-stack model" migration (Step 0).
 *
 * TARGET model: a cell is a fixed slot; everything in it is a uniform TILE with Width/Depth/HEIGHT
 * (h:0 = flat floor, ≥1 = an extruded block); a cell holds an ORDERED stack, index 0 = the floor.
 *
 * Today that data is split across `IsometricGrid`:
 *   - `ground[row][col]`      — floor slug (e.g. 'grass')
 *   - `groundColor[row][col]` — floor colour override (null = catalog colour)
 *   - `groundDims[row][col]`  — floor Width/Height/Depth/Zoom + pose (GroundCellDims)
 *   - `assets[]`              — flat list; each carries col/row/heightLevel/height/scaleX/scaleY/scaleZ/
 *                               scale/tileOverride/color/blocking/… (GridAsset)
 * (Terrain `height[row][col]` is a CELL elevation prop, NOT a tile — it is left untouched.)
 *
 * This module is PURELY ADDITIVE: it PROJECTS those current fields onto the target `TileEntry[]` stack
 * (and back, via mutators that call the grid's existing setters). It changes NO existing behaviour and
 * touches no render/codec/collision path — later migration steps consume it. Pure + unit-tested.
 */
import type { IsometricGrid, GridAsset } from './IsometricGrid'
import type { GroundCellDims } from './groundDims'
import type { TilePose } from './tileset/pose'
import { resolveTileHeight } from './tileset/tileHeight'

/** Which legacy layer a TileEntry projects from — lets a consumer/mutator route back to the right setter. */
export type TileSource = 'floor' | 'asset'

/**
 * One uniform tile in a cell's stack. The target model's atom: everything in a cell — the floor and every
 * stacked prop/block — is a TileEntry. Populated by forward projection over the CURRENT split fields; the
 * `source`/`heightLevel`/`art`/`type`/`label` carry-throughs let the mutators reconstruct the legacy shape
 * losslessly for the round-trip.
 */
export interface TileEntry {
  /** style-agnostic Tile Library id pinning this cell's visual (GridAsset.tileOverride). Floor tiles follow
   *  the active style, so this is absent for the floor. */
  tileId?: string
  /** what this tile IS: the ground slug for the floor; `label ?? type` for a stacked asset. */
  slug: string
  /** Width (x) — horizontal stretch. GroundCellDims.scaleX / GridAsset.scaleX. Absent = tile default (→1). */
  w?: number
  /** Depth (into-screen ground axis). GroundCellDims.scaleZ / GridAsset.scaleZ. Absent = tile default (→1). */
  d?: number
  /** BLOCK height: 0 = flat floor tile, ≥1 = extruded cube. resolveTileHeight(GridAsset.height); floor = 0.
   *  Absent = do NOT pin a per-instance height — the renderer falls back to the tile's catalog height (the
   *  editor brush relies on this so a placed house/tree keeps its authored extrusion). */
  h?: number
  /** Zoom — uniform multiplier over every axis. GroundCellDims.scale / GridAsset.scale. */
  zoom?: number
  /** Height (up) — vertical sprite stretch (grows UP). GroundCellDims.scaleY / GridAsset.scaleY. Carried;
   *  a flat floor has no vertical axis but the value round-trips through save/load. */
  scaleY?: number
  /** per-cell pose (position/rotation within the cell). Floor tiles only today (GroundCellDims.pose). */
  pose?: TilePose
  /** colour override (GroundCellDims via groundColor / GridAsset.color). null/absent = catalog colour. */
  color?: string | null
  /** per-instance sprite opacity (GridAsset.opacity). absent = fully opaque (the renderer uses `opacity ?? 1`). */
  opacity?: number
  /** does this tile block movement (GridAsset.blocking). See deriveCellCollision. */
  collision?: boolean
  /** which legacy layer this entry came from. */
  source: TileSource
  /** stack level carried from the asset (GridAsset.heightLevel). Floor = 0. */
  heightLevel?: number
  /** carry-through of the asset's visual (GridAsset.art) — floor tiles have none. */
  art?: string[]
  /** carry-through of the asset's type (GridAsset.type) — floor tiles have none. */
  type?: string
  /** carry-through of the asset's cell-part label (GridAsset.label) — floor tiles have none. */
  label?: string
}

/** Legacy per-cell data (what the codec holds per cell). `migrateAssetsToStack` turns it into a stack. */
export interface LegacyCell {
  /** ground[row][col] — the floor slug. */
  groundData: string
  /** groundColor[row][col] — floor colour override (null = catalog colour). */
  groundColor?: string | null
  /** groundDims[row][col] — floor Width/Height/Depth/Zoom + pose. */
  groundDims?: GroundCellDims
  /** the GridAssets sitting on this cell (any order — sorted by heightLevel here). */
  assetsData: GridAsset[]
}

/** The floor tile (stack index 0) built from the cell's ground slug + colour + dims. Always h:0 (flat).
 *
 *  NOTE on collision: terrain/base collision (grid.collision, e.g. water) is a CELL field in the legacy
 *  model. This additive step projects only ground/colour/dims onto the floor tile (per the migration plan),
 *  so the floor carries no collision — cell collision in the stack model derives from asset blocking (see
 *  deriveCellCollision). Folding terrain collision onto the floor tile is a later step. */
function floorEntry(groundData: string, color: string | null | undefined, dims: GroundCellDims | undefined): TileEntry {
  return {
    source: 'floor',
    slug: groundData,
    w: dims?.scaleX ?? 1,
    d: dims?.scaleZ ?? 1,
    h: 0,
    zoom: dims?.scale,
    scaleY: dims?.scaleY,
    pose: dims?.pose,
    color: color ?? null,
    heightLevel: 0,
  }
}

/** A stacked asset → its uniform TileEntry. Height goes through resolveTileHeight (0-clamped, matches the
 *  iso renderer); blocking → collision; tileOverride → tileId; scaleX/scaleZ/scale → w/d/zoom. */
function assetEntry(a: GridAsset): TileEntry {
  return {
    source: 'asset',
    tileId: a.tileOverride,
    slug: a.label ?? a.type,
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
 * PURE forward projection of raw legacy cell data onto the target stack — the same result `getStack`
 * produces, but from plain data (no grid). Used by the codec step. Index 0 = floor; 1.. = the assets
 * sorted by heightLevel (index 0 = closest to the floor).
 */
export function migrateAssetsToStack(cell: LegacyCell): TileEntry[] {
  const assets = [...cell.assetsData].sort((a, b) => (a.heightLevel ?? 0) - (b.heightLevel ?? 0))
  return [floorEntry(cell.groundData, cell.groundColor, cell.groundDims), ...assets.map(assetEntry)]
}

/**
 * The cell's tile stack, forward-projected over the CURRENT grid fields. Does NOT mutate the grid.
 * Delegates to `migrateAssetsToStack` so the two producers can never drift.
 */
export function getStack(grid: IsometricGrid, col: number, row: number): TileEntry[] {
  return migrateAssetsToStack({
    groundData: grid.ground[row]?.[col] ?? 'grass',
    groundColor: grid.groundColor[row]?.[col] ?? null,
    groundDims: grid.groundDims[row]?.[col],
    assetsData: grid.getAssetsAtCell(col, row),
  })
}

/** Cell collision in the stack model = ANY tile in the stack blocks. Today that is the OR of the assets'
 *  blocking flags (the floor carries no collision in this step — see floorEntry). */
export function deriveCellCollision(stack: TileEntry[]): boolean {
  return stack.some(t => t.collision === true)
}

// ── mutators: translate stack ops back onto the grid's EXISTING setters (used by later steps) ──

/** setFloor → setGround / setGroundColor / setGroundDims. Writes the floor tile (index 0) of the cell.
 *  Only the floor's own fields are written; h is ignored (the floor is always flat). */
export function setFloor(grid: IsometricGrid, col: number, row: number, entry: TileEntry): void {
  grid.setGround(col, row, entry.slug)
  grid.setGroundColor(col, row, entry.color ?? null)
  const dims: Partial<GroundCellDims> = { scaleX: entry.w, scaleZ: entry.d }
  if (entry.zoom !== undefined) dims.scale = entry.zoom
  if (entry.scaleY !== undefined) dims.scaleY = entry.scaleY
  if (entry.pose !== undefined) dims.pose = entry.pose
  grid.setGroundDims(col, row, dims)
}

/** The current top stack level at a cell, or -1 when the cell holds only its floor. */
function topLevel(grid: IsometricGrid, col: number, row: number): number {
  const assets = grid.getAssetsAtCell(col, row)
  if (assets.length === 0) return -1
  return assets.reduce((max, a) => Math.max(max, a.heightLevel ?? 0), 0)
}

/** pushTile → placeAsset at heightLevel = (top + 1). placeAsset's fixed option list drops the per-instance
 *  dims (scaleX/scaleZ/scaleY/height) and the label, so we assign those onto the just-placed asset to keep
 *  the uniform-tile push lossless. Each patch is applied ONLY when the entry actually pins that field: an
 *  entry that OMITS w/d/h (the editor brush, which places a tile at its catalog size/height) leaves
 *  scaleX/scaleZ/height undefined so the renderer falls back to the tile default — byte-identical to the
 *  pre-adapter placeAsset call. Returns the placed GridAsset. */
export function pushTile(grid: IsometricGrid, col: number, row: number, entry: TileEntry): GridAsset {
  const heightLevel = topLevel(grid, col, row) + 1
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

/** popTile → remove the TOP asset (highest heightLevel) at the cell. Returns the removed asset, or
 *  undefined when the cell holds only its floor. Cell collision is not recomputed here (Step 0 mirrors the
 *  legacy model, which does not unblock on single-asset removal). */
export function popTile(grid: IsometricGrid, col: number, row: number): GridAsset | undefined {
  const assets = grid.getAssetsAtCell(col, row)
  if (assets.length === 0) return undefined
  const top = assets[assets.length - 1]
  grid.removeAssetsWhere(a => a === top)
  return top
}

/** setTileCollision → setCollision. The legacy collision setter is cell-level, so this translates the
 *  stack's "does this cell block" flag straight onto grid.collision[row][col]. */
export function setTileCollision(grid: IsometricGrid, col: number, row: number, blocking: boolean): void {
  grid.setCollision(col, row, blocking)
}
