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
import { reachOf } from '@/engine/render/isoBlock'
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

/**
 * One axis of the box: how far it reaches each way from the cell's centre.
 *
 * The SIZE sets the half-extent and each REACH pulls its own face in, so a door thin toward its wall
 * blocks a strip along that wall rather than a centred square. Clamped at the end rather than at the
 * start: clamping the size first and then multiplying by a reach could still take the final box below
 * the minimum, and a box that shrinks to nothing lets a body walk through a solid tile.
 */
const axis = (size: number, minusReach: number, plusReach: number): { minus: number; plus: number; span: number } => {
  const half = Math.min(1, Math.max(0, size)) / 2
  const minus = half * minusReach
  const plus = half * plusReach
  const span = minus + plus
  if (span >= MIN_BOX_SIDE) return { minus, plus, span }

  // Too thin to be real. Keep the side it was leaning toward, widened to the minimum.
  const grow = MIN_BOX_SIDE / (span > 0 ? span : 1)
  return span > 0
    ? { minus: minus * grow, plus: plus * grow, span: MIN_BOX_SIDE }
    : { minus: MIN_BOX_SIDE / 2, plus: MIN_BOX_SIDE / 2, span: MIN_BOX_SIDE }
}

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
  // "All of it" means all of what it DRAWS, and what a tile draws inside its own cell is two things:
  // how big it is (Width across, Depth into the screen) and how far it REACHES toward each face.
  //
  // It used to read the size alone, back when a thinness and a size shared one field. They are separate
  // now, so a thin door has to be read from its thickness or the box it makes solid is the whole cell
  // and you cannot walk past it.
  //
  // The four reaches are iso diagonals and map onto the grid: left-up is −col, right-down is +col,
  // right-up is −row, left-down is +row. Each pulls its own face in, so a door thin toward its wall
  // blocks a strip along that wall rather than a centred square.
  const { w, h } = resolveAssetDrawSize(1, asset, 'overhead')
  if (!(w > 0) || !(h > 0)) return [FULL_CELL]

  const reach = asset.thickness ?? {}
  const across = axis(w, reachOf(reach, 'left-up'), reachOf(reach, 'right-down'))
  const into = axis(h, reachOf(reach, 'right-up'), reachOf(reach, 'left-down'))

  if (across.span >= 1 && into.span >= 1) return [FULL_CELL]

  return [{ x: 0.5 - across.minus, y: 0.5 - into.minus, w: across.span, h: into.span }]
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
