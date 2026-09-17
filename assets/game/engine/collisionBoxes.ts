/**
 * COLLISION BOXES: what a tile actually occupies inside its cell.
 *
 * THE BOX LIST IS THE ONLY STATEMENT.
 *
 * That is right, and until now this file was the reason it was not true: it opened with `if (!asset.blocking)
 * return []`, so the boxes could only ever REFINE a decision the flag had already made. Measured against live
 * at the time: 0 of 375 tiles carried a box and 72 carried `blocking: true`. The fact lived in the flag and
 * the system that owned it was empty. The backend now writes `settings.collision` on every row
 * (`ensure_collisions/0`, seeded from the flag so nothing moved), and the rule here is one line:
 *
 *     a tile is solid where its boxes are, and a tile with no boxes is not solid at all.
 *
 * A tile with authored boxes uses them (as many as it likes, each positioned and sized). A tile whose box is
 * the WHOLE CELL, what the seeding writes, and what "solid" has always meant, shrinks to the size it is
 * DRAWN at, which is already data: a standard trunk draws at 0.6 of its cell, so it occupies 0.6 of it. That
 * keeps walls, rocks and buildings unchanged while a tree stops blocking the gap beside it.
 */
import { resolveAssetDrawSize } from './render/assetDimensions'
import { styleTile } from './tileset/styleTiles'
import type { GridAsset } from './IsometricGrid'

/** A solid box inside one cell, in cell fractions with the cell's top-left as the origin. */
export interface CollisionBox { x: number; y: number; w: number; h: number }

/** The whole cell, the way collision has always worked. */
export const FULL_CELL: CollisionBox = { x: 0, y: 0, w: 1, h: 1 }
/** However thin a tile is drawn, its box never falls below this, or it could be stepped through. */
export const MIN_BOX_SIDE = 0.2

const clamp01 = (n: number) => Math.max(MIN_BOX_SIDE, Math.min(1, n))

/** Is this the plain "all of it" box the seeding writes, rather than a shape somebody authored? */
const isWholeCell = (boxes: readonly CollisionBox[]): boolean =>
  boxes.length === 1 && boxes[0].x === 0 && boxes[0].y === 0 && boxes[0].w === 1 && boxes[0].h === 1

/**
 * The boxes this asset DECLARES, before any shrink: a per-instance list wins, else the DB tile's own. Read
 * through the same path as height, stackAt and act-as-tile, so collision is a tile fact like any other and
 * cannot drift from them.
 */
function declaredBoxes(asset: GridAsset): readonly CollisionBox[] {
  const perInstance = asset.settings?.collision
  if (Array.isArray(perInstance)) return perInstance
  const slug = asset.label ?? asset.tileKey ?? asset.type
  const tile = styleTile('ascii', slug) ?? styleTile('emoji', slug)
  const served = (tile?.settings as { collision?: CollisionBox[] } | undefined)?.collision
  return Array.isArray(served) ? served : []
}

/** What this asset makes solid, in cell fractions. Empty when it does not block at all. */
export function boxesForAsset(asset: GridAsset): readonly CollisionBox[] {
  const declared = declaredBoxes(asset)
  if (declared.length === 0) return []
  if (!isWholeCell(declared)) return declared // an authored shape is used verbatim, never second-guessed
  // "All of it" means all of what it DRAWS: width across, thickness into the screen (assetDimensions' overhead).
  const { w, h } = resolveAssetDrawSize(1, asset, 'overhead')
  if (!(w > 0) || !(h > 0) || (w >= 1 && h >= 1)) return [FULL_CELL]
  const bw = clamp01(w)
  const bh = clamp01(h)
  return [{ x: (1 - bw) / 2, y: (1 - bh) / 2, w: bw, h: bh }]
}

/** Does this asset make ANYTHING solid? The single question the cell grid asks, replacing `asset.blocking`. */
export function assetIsSolid(asset: GridAsset): boolean {
  return declaredBoxes(asset).length > 0
}

/** Every solid box in one cell. */
export function cellBoxes(assets: readonly GridAsset[]): CollisionBox[] {
  return assets.flatMap(a => [...boxesForAsset(a)])
}

/** Is this point inside the box? Edges count as touching, so a body resting against a box stays out of it. */
export function boxHolds(box: CollisionBox, fx: number, fz: number): boolean {
  return fx >= box.x && fx <= box.x + box.w && fz >= box.y && fz <= box.y + box.h
}

/** The grid this reads: enough of IsometricGrid to test a point, so the module stays pure and testable. */
export interface BoxGrid {
  cols: number
  rows: number
  cellSize: number
  isBlocked(col: number, row: number): boolean
  getAssetsAtCell(col: number, row: number): GridAsset[]
}

/**
 * Is this world point solid? Out of bounds is; a clear cell is not. In a blocked cell the point has to actually
 * touch one of the cell's boxes, EXCEPT where the block comes from something with no boxes of its own (collision
 * painted by hand, or set by the generator with no asset behind it), which stays solid wall to wall as before.
 */
export function worldPointBlocked(grid: BoxGrid, x: number, z: number): boolean {
  const col = Math.floor(x / grid.cellSize)
  const row = Math.floor(z / grid.cellSize)
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return true
  if (!grid.isBlocked(col, row)) return false
  const assets = grid.getAssetsAtCell(col, row)
  const boxes = cellBoxes(assets)
  if (boxes.length === 0) return true // blocked with nothing to measure: the whole cell, as before
  const fx = x / grid.cellSize - col
  const fz = z / grid.cellSize - row
  return boxes.some(b => boxHolds(b, fx, fz))
}
