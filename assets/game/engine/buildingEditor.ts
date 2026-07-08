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

/**
 * The walkable DOOR run — the GridBuilding twin of the generator's `doorCells` (stageGenerator.ts), so a
 * hand-placed/moved building opens the SAME entrance a generated one does. The DRAWN facade door can be
 * more than one cell wide (a hospital's 2-wide civic doorway, a cathedral's 3-wide ceremonial one), so the
 * walkable opening must be that wide too — otherwise a wide door has a walkable half and a blocked half
 * ("walk between two tiles but not the actual entrance"). AXIS-ALIGNED (south/north) facades draw the door
 * at its full width, centred on the walkable door column, so the opening spans those same cells. ROTATED
 * (east/west) facades collapse the drawn door to a single edge cell (draw2DBuilding maps one road-edge
 * column to the door, the rest to wall), so the opening stays 1 cell there — matching what's drawn.
 */
export function buildingDoorCells(b: GridBuilding): Cell[] {
  const facing = gridBuildingFacing(b)
  const rect = buildingRect(b)
  const door = doorCellFor(facing, rect)
  if (facing === 'east' || facing === 'west') return [door] // rotated → the single collapsed edge cell
  // south/north: a run `doorCount` cells wide, centred on the walkable door column — the SAME cells the
  // 2D facade + iso door run draw (drawn width == b.cells' bottom-row 'door' count).
  const bottomRow = b.cells[b.cells.length - 1] ?? []
  const doorCount = Math.max(1, bottomRow.filter(k => k === 'door').length)
  const start = Math.max(rect.col, Math.min(rect.col + rect.w - doorCount, door.col - Math.floor(doorCount / 2)))
  const cells: Cell[] = []
  for (let i = 0; i < doorCount; i++) cells.push({ col: start + i, row: door.row })
  return cells
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

/** A footprint tile in ABSOLUTE grid coords + its role + iso block height — the on-grid twin of the
 *  pure buildingFootprint() cell. */
export interface GridFootprintCell {
  col: number
  row: number
  kind: 'wall' | 'floor' | 'door'
  /** iso block height: walls rise `floors` blocks; floor/door are flat (0). */
  height: number
}

/**
 * Regenerate a saved facade building into wall / floor / door TILES (the 2D+3D model): every perimeter
 * cell becomes a WALL at height = the facade's floor count, the interior becomes flat FLOOR, and the
 * road-facing DOOR cell (doorCellFor — facing-aware) stays flat so its connector survives. Position,
 * size and floors are kept; the old facade's exact per-cell art is dropped. Pure — called on template
 * LOAD so pre-tileset maps come back as tiles instead of the retired facade box.
 */
export function facadeToFootprint(b: GridBuilding): GridFootprintCell[] {
  const rect = buildingRect(b)
  const door = doorCellFor(gridBuildingFacing(b), rect)
  // Floors = the facade's body rows (anything that isn't pure roof/empty). Clamp to ≥1 so a stubby
  // saved facade still rises one block.
  const floors = Math.max(1, b.cells.filter(r => r.some(k => k === 'wall' || k === 'window' || k === 'door')).length)
  const cells: GridFootprintCell[] = []
  for (let row = rect.row; row < rect.row + rect.h; row++) {
    for (let col = rect.col; col < rect.col + rect.w; col++) {
      const isDoor = col === door.col && row === door.row
      const perimeter = col === rect.col || col === rect.col + rect.w - 1 || row === rect.row || row === rect.row + rect.h - 1
      const kind: GridFootprintCell['kind'] = isDoor ? 'door' : perimeter ? 'wall' : 'floor'
      cells.push({ col, row, kind, height: kind === 'wall' ? floors : 0 })
    }
  }
  return cells
}

/** True iff (col,row) lies on the building's footprint. */
export function footprintContains(b: GridBuilding, col: number, row: number): boolean {
  const r = buildingRect(b)
  return col >= r.col && col < r.col + r.w && row >= r.row && row < r.row + r.h
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

/** The primary paved road/driveway ground (what the settlement generator carves streets + driveways
 *  as). Kept for callers that stamp/scan the canonical road tile. */
export const ROAD_GROUND = 'path_stone'

/** EVERY ground type that reads as a walkable ROAD/PATH a building's footprint may NOT cover. A building
 *  fronts a road from one cell away, so its footprint never sits on the road itself; impassable terrain
 *  (water/lava/…) is already collision, so only the *walkable* road types need a ground-level exclusion.
 *  ONE definition, shared by the pure placement policy here AND the editor's placement guard — they used
 *  to diverge (this module saw only 'path_stone', so `canPlaceBuilding` happily stamped a building onto a
 *  generated 'road_center'/'road_edge' street: the "building still mixes with the road" bug). */
export const ROAD_GROUNDS: ReadonlySet<string> = new Set([
  'road', 'road_center', 'road_edge', 'plaza', 'path_stone', 'path_dirt', 'bridge',
  'snow_path', 'desert_road', 'wooden_planks', 'courtyard_stone',
])

/** True iff a ground type reads as a road/path (buildings never sit on these). */
export function isRoadGround(ground: string | undefined): boolean {
  return ground != null && ROAD_GROUNDS.has(ground)
}

/**
 * Is a single grid cell unavailable to a building's footprint? A cell is taken only when it
 *   - already belongs to another building/asset footprint (`occupied`),
 *   - carries `collision` (trees, water, lava, features, or any *blocking* asset), or
 *   - is a road/path of ANY kind (`isRoadGround` — road_center/road_edge/path_stone/…).
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
  return occupied || collision || isRoadGround(ground)
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
export function makeBuilding(type: BuildingType, facing: Facing, centerCol: number, centerRow: number, seed?: number): GridBuilding {
  // `seed` (optional) drives the seeded peaked-vs-box roof roll for store/hospital; omitted → a box roof
  // (the default), so existing callers/tests are byte-identical.
  const facade = composeBuilding({ type, seed })
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
