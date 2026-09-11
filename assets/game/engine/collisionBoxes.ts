/**
 * COLLISION BOXES: what a tile actually occupies inside its cell.
 *
 * Alexander, 2026-09-11 (Image #17, standing between two trees): *"we need to fix the collisions of objects,
 * specifically, they should adapt to the size of the tile ... the character behaves as if I'm colliding with walls,
 * when there's plenty of space between the tree and my unit ... the collision takes the size of the cell by default,
 * I think we need to be able to control the size of the collission and use it as the base for the hitboxes system ...
 * we can modify cells to have many collisions and we can position and modify the size of those collision blocks at
 * will, unit collide with these blocks on real contact"*.
 *
 * A cell is still either blocked or not for everything that thinks in CELLS (pathing, spawning, the generator's
 * connectivity). This is the finer truth underneath, for anything that moves as a BODY: which parts of the cell are
 * solid. A tile with authored boxes uses them (as many as it likes, each positioned and sized). A tile without them
 * falls back to the size it is DRAWN at, which is already data: a standard trunk draws at 0.6 of its cell, so it
 * blocks 0.6 of its cell instead of all of it. Anything with no size of its own keeps the whole cell, so walls,
 * rocks, buildings and hand-painted collision are unchanged.
 */
import { resolveAssetDrawSize } from './render/assetDimensions'
import type { GridAsset } from './IsometricGrid'

/** A solid box inside one cell, in cell fractions with the cell's top-left as the origin. */
export interface CollisionBox { x: number; y: number; w: number; h: number }

/** The whole cell, the way collision has always worked. */
export const FULL_CELL: CollisionBox = { x: 0, y: 0, w: 1, h: 1 }
/** However thin a tile is drawn, its box never falls below this, or it could be stepped through. */
export const MIN_BOX_SIDE = 0.2

const clamp01 = (n: number) => Math.max(MIN_BOX_SIDE, Math.min(1, n))

/** What this asset makes solid, in cell fractions. Empty when it does not block at all. */
export function boxesForAsset(asset: GridAsset): readonly CollisionBox[] {
  if (!asset.blocking) return []
  const authored = asset.settings?.collision
  if (authored && authored.length > 0) return authored
  // The GROUND footprint it is drawn with: width across, thickness into the screen (assetDimensions' overhead view).
  const { w, h } = resolveAssetDrawSize(1, asset, 'overhead')
  if (!(w > 0) || !(h > 0) || (w >= 1 && h >= 1)) return [FULL_CELL]
  const bw = clamp01(w)
  const bh = clamp01(h)
  return [{ x: (1 - bw) / 2, y: (1 - bh) / 2, w: bw, h: bh }]
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
