/**
 * Manual building editor — PURE geometry + validity for select / move / rotate /
 * delete / place of a `GridBuilding` on a running grid.
 *
 * The stage GENERATOR (stageGenerator.ts) stamps buildings from a planner `Plot`;
 * this module is its live-editing twin, working directly on the `GridBuilding`
 * model the three views already read (grid.buildings). It is pure logic — no
 * rendering, no IsometricGrid mutation — so the footprint math + the placement
 * rule are unit-testable in isolation; templates.tsx wires them to a live stamp.
 *
 * The load-bearing invariant: a building's footprint cells BLOCK (walls/roof)
 * EXCEPT its single road-facing DOOR cell, which stays walkable. Every helper
 * here preserves that, so collision == footprint after every edit.
 */
import type { GridBuilding } from './IsometricGrid'
import type { Facing } from './villageLayout'
import { isoFacingIndex, isoFacadeOnBack } from './isoBuilding'
import { composeBuilding, type BuildingType } from './buildingComposer'

export interface Cell {
  col: number
  row: number
}

/** A footprint rectangle on the grid: top-left (col,row) + width × height. */
export interface FootRect {
  col: number
  row: number
  w: number
  h: number
}

/** Rotation order: south → east → north → west (then back to south). */
export const FACING_CYCLE: readonly Facing[] = ['south', 'east', 'north', 'west'] as const

/**
 * Reconstruct the 4-way planner facing from a GridBuilding's iso fields. A
 * GridBuilding only stores the iso billboard axis (`facing` 0/1) + whether the
 * facade is on the camera-far face (`facadeOnBack`); together they map 1:1 back
 * to the original road-facing direction (the inverse of isoFacingIndex/
 * isoFacadeOnBack used when a stage is applied).
 */
export function gridBuildingFacing(b: GridBuilding): Facing {
  const back = b.facadeOnBack ?? false
  if ((b.facing ?? 0) === 1) return back ? 'west' : 'east'
  return back ? 'north' : 'south'
}

/** The iso orientation fields (facing axis + facadeOnBack) for a 4-way facing. */
export function isoOrientation(facing: Facing): { facing: number; facadeOnBack: boolean } {
  return { facing: isoFacingIndex(facing), facadeOnBack: isoFacadeOnBack(facing) }
}

/** A GridBuilding's GROUND footprint rect. `row` is the BOTTOM (front) row, so the
 *  rect's top-left is (col, row - (height - 1)). Mirrors how the renders derive it. */
export function buildingRect(b: GridBuilding): FootRect {
  return { col: b.col, row: b.row - (b.height - 1), w: b.length, h: b.height }
}

/** The single walkable DOOR cell — the centre of the footprint's road-facing edge.
 *  Mirrors stageGenerator.doorCell exactly so the live stamp lands the door where
 *  generation would. */
export function doorCellFor(facing: Facing, rect: FootRect): Cell {
  const midCol = rect.col + Math.floor(rect.w / 2)
  const midRow = rect.row + Math.floor(rect.h / 2)
  if (facing === 'south') return { col: midCol, row: rect.row + rect.h - 1 } // road below → bottom edge
  if (facing === 'north') return { col: midCol, row: rect.row } // road above → top edge
  if (facing === 'east') return { col: rect.col + rect.w - 1, row: midRow } // road right → right edge
  return { col: rect.col, row: midRow } // west: road left → left edge
}

/** The single walkable door cell for a GridBuilding. */
export function buildingDoorCell(b: GridBuilding): Cell {
  return doorCellFor(gridBuildingFacing(b), buildingRect(b))
}

/** True iff (col,row) is the building's walkable door cell. */
export function isDoorCell(b: GridBuilding, col: number, row: number): boolean {
  const d = buildingDoorCell(b)
  return d.col === col && d.row === row
}

/**
 * Every cell a building occupies + which one is the (walkable) door. The whole
 * rect is the footprint; `door` is the lone walkable cell — everything else blocks.
 */
export function buildingFootprintCells(b: GridBuilding): { cells: Cell[]; door: Cell } {
  const rect = buildingRect(b)
  const door = doorCellFor(gridBuildingFacing(b), rect)
  const cells: Cell[] = []
  for (let row = rect.row; row < rect.row + rect.h; row++) {
    for (let col = rect.col; col < rect.col + rect.w; col++) cells.push({ col, row })
  }
  return { cells, door }
}

/** True iff (col,row) lies on the building's footprint. */
export function footprintContains(b: GridBuilding, col: number, row: number): boolean {
  const r = buildingRect(b)
  return col >= r.col && col < r.col + r.w && row >= r.row && row < r.row + r.h
}

/** Which VIEW's collision we want. Each view is a different PROJECTION of the same 3D building, so the
 *  cells it occupies (and thus its collision) differ. */
export type BuildingCollisionView = 'top' | 'td' | 'iso'

/** The building's facade elevation height in rows (b.cells rows). Falls back to the footprint row-span. */
export function buildingFacadeHeight(b: GridBuilding): number {
  return Math.max(1, b.cells?.length ?? b.height)
}

/** The grid cells a building occupies IN A GIVEN VIEW, BEYOND its flat top-down footprint (already in
 *  grid.collision). Each view is a different projection of the 3D box, so collision differs:
 *   - TOP (roof from above, X/Y layout, no height): footprint only → NO extra cells.
 *   - 2D  (front elevation: width × height, no depth): the facade rises to its full HEIGHT straight up
 *         (north) → extra = the (facadeHeight − footprintDepth) rows ABOVE the footprint, W wide.
 *   - ISO (3D box, X/Y/Z): the box rises along the iso vertical, which on the iso screen is the (−1,−1)
 *         grid diagonal → extra = the footprint swept up that diagonal by the facade height.
 *  Excludes the footprint itself. Pure → unit-tested + overlay-validated (the tint must cover the drawn
 *  building exactly, in the user's running game). */
export function buildingViewExtraCells(b: GridBuilding, view: BuildingCollisionView): Cell[] {
  if (view === 'top') return []
  const rect = buildingRect(b)
  const facadeH = buildingFacadeHeight(b)
  const frontRow = rect.row + rect.h - 1 // the footprint's front (bottom, largest-row) edge
  const out: Cell[] = []
  if (view === 'td') {
    // 2D elevation stands W wide × facadeH tall, upright from the front row → the extra cells are the
    // facade rows ABOVE the footprint's own rows.
    for (let row = frontRow - (facadeH - 1); row < rect.row; row++)
      for (let col = rect.col; col < rect.col + rect.w; col++) out.push({ col, row })
    return out
  }
  // ISO: the box rises up-screen along the (−1,−1) grid diagonal (iso "straight up"). Its drawn height is
  // facadeH levels × vCell(≈ one row's screen-height, tileH); one (−1,−1) grid step moves 2·tileH on the
  // iso screen, so the box covers ceil(facadeH/2) grid steps up the diagonal — the sweep `reach`. Its extra
  // cells are the footprint swept up by `reach`, generated with a single predicate scan (no per-cell sweep
  // + dedup Set): a cell (c,r) up-left of the footprint is covered iff some footprint cell sits exactly k
  // steps down-right for a k in 1..reach. O(area), one push per output cell, zero allocation.
  const rc = rect.col, rr = rect.row, W = rect.w, D = rect.h
  const reach = Math.max(1, Math.ceil(facadeH / 2))
  for (let r = rr - reach; r < rr + D; r++) {
    for (let c = rc - reach; c < rc + W; c++) {
      if (c >= rc && r >= rr) continue // the footprint (down-right quadrant) is already blocked
      const lo = Math.max(rc - c, rr - r, 1)
      const hi = Math.min(rc + W - 1 - c, rr + D - 1 - r, reach)
      if (lo <= hi) out.push({ col: c, row: r })
    }
  }
  return out
}

/** The footprint dimension PARALLEL to the road (the facade length / frontage span),
 *  as opposed to the perpendicular `depth`. Invariant across rotations. */
export function facadeLength(b: GridBuilding): number {
  return (b.facing ?? 0) === 1 ? b.height : b.length
}

/** What blocks a placement, abstracted so the rule is pure + testable. `blocked`
 *  reports a cell occupied by something the building may NOT cover (another
 *  building, blocking terrain, a road); the caller excludes the moving building's
 *  own cells before asking. */
export interface PlacementEnv {
  cols: number
  rows: number
  blocked: (col: number, row: number) => boolean
}

/** A building may be placed iff every footprint cell is in-bounds and not blocked. */
export function canPlaceBuilding(env: PlacementEnv, b: GridBuilding): boolean {
  const { cells } = buildingFootprintCells(b)
  return cells.every(
    c => c.col >= 0 && c.row >= 0 && c.col < env.cols && c.row < env.rows && !env.blocked(c.col, c.row),
  )
}

/** The one walkable ground a building footprint may NOT cover: a road. A building fronts a
 *  road from one cell away, so its footprint never sits on the road itself. Impassable
 *  terrain (water/lava/…) is already collision, so the collision check below handles that —
 *  only the *walkable* road needs a ground-level exclusion. */
export const ROAD_GROUND = 'path_stone'

/**
 * Is a single grid cell unavailable to a building's footprint? A cell is taken only when it
 *   - already belongs to another building/asset footprint (`occupied`),
 *   - carries `collision` (trees, water, lava, features, or any *blocking* asset), or
 *   - is a road (`ground === ROAD_GROUND`).
 * Everything else is free — bare grass, an interior floor, or a walkable cell that merely
 * holds non-blocking ground decor. Pure, so the manual-placement policy is testable on its
 * own and reads the same way the spec states it: not occupied, not collision, not a road.
 */
export function buildingCellBlocked({
  occupied,
  collision,
  ground,
}: {
  occupied: boolean
  collision: boolean
  ground: string
}): boolean {
  return occupied || collision || ground === ROAD_GROUND
}

/** Move a building by (dCol,dRow). Pure — returns a new GridBuilding. */
export function moveBuilding(b: GridBuilding, dCol: number, dRow: number): GridBuilding {
  return { ...b, col: b.col + dCol, row: b.row + dRow }
}

/**
 * Rotate a building to the NEXT facing (south→east→north→west), keeping its
 * footprint CENTRE fixed and swapping the oriented dimensions (length↔depth on
 * the grid). The facade `cells` are orientation-independent (2D always draws them
 * door-down), so only the iso facing axis + facadeOnBack + the grid span change.
 * Pure — returns a new GridBuilding.
 */
export function rotateBuilding(b: GridBuilding): GridBuilding {
  const facing = gridBuildingFacing(b)
  const next = FACING_CYCLE[(FACING_CYCLE.indexOf(facing) + 1) % FACING_CYCLE.length]
  return orientBuilding(b, next, footprintCenter(b))
}

/** Re-anchor a building at a target facing, with its footprint CENTRE at `center`.
 *  Derives the oriented grid span from facadeLength + depth. Pure. */
export function orientBuilding(b: GridBuilding, facing: Facing, center: Cell): GridBuilding {
  const facadeLen = facadeLength(b)
  const depth = b.depth
  const horizontal = facing === 'south' || facing === 'north'
  const w = horizontal ? facadeLen : depth
  const h = horizontal ? depth : facadeLen
  const col = center.col - Math.floor(w / 2)
  const topRow = center.row - Math.floor(h / 2)
  const iso = isoOrientation(facing)
  return { ...b, col, row: topRow + h - 1, length: w, height: h, depth, facing: iso.facing, facadeOnBack: iso.facadeOnBack }
}

/** Resize a building's FACADE LENGTH (frontage), keeping its type, facing, and footprint CENTRE.
 *  Re-composes the facade at the new length (composeBuilding clamps to its own MIN_LENGTH) and
 *  re-derives the oriented grid span + cells — i.e. "make a house 4 or 6 cells long, then let the iso
 *  logic re-extrude it". Pure — returns a new GridBuilding. */
export function resizeBuilding(b: GridBuilding, facadeLen: number): GridBuilding {
  const facade = composeBuilding({ type: b.type as BuildingType, length: facadeLen })
  const facing = gridBuildingFacing(b)
  const center = footprintCenter(b)
  const horizontal = facing === 'south' || facing === 'north'
  const w = horizontal ? facade.length : facade.depth
  const h = horizontal ? facade.depth : facade.length
  const col = center.col - Math.floor(w / 2)
  const topRow = center.row - Math.floor(h / 2)
  const iso = isoOrientation(facing)
  return { ...b, col, row: topRow + h - 1, length: w, height: h, depth: facade.depth, cells: facade.cells, facing: iso.facing, facadeOnBack: iso.facadeOnBack }
}

/** The footprint's centre cell (used to keep a rotation in place). */
export function footprintCenter(b: GridBuilding): Cell {
  const r = buildingRect(b)
  return { col: r.col + Math.floor(r.w / 2), row: r.row + Math.floor(r.h / 2) }
}

/**
 * Build a fresh GridBuilding of `type` facing `facing`, with its footprint's
 * CENTRE at (centerCol,centerRow). Sizing (length/height/depth) + facade come
 * from composeBuilding, so a manually-placed building matches a generated one of
 * the same type. Pure (no grid).
 */
export function makeBuilding(type: BuildingType, facing: Facing, centerCol: number, centerRow: number): GridBuilding {
  const facade = composeBuilding({ type })
  const horizontal = facing === 'south' || facing === 'north'
  const w = horizontal ? facade.length : facade.depth
  const h = horizontal ? facade.depth : facade.length
  const col = centerCol - Math.floor(w / 2)
  const topRow = centerRow - Math.floor(h / 2)
  const iso = isoOrientation(facing)
  return {
    col,
    row: topRow + h - 1,
    length: w,
    height: h,
    depth: facade.depth,
    type,
    cells: facade.cells,
    facing: iso.facing,
    facadeOnBack: iso.facadeOnBack,
  }
}
