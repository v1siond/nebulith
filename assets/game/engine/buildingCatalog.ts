/**
 * Building CATALOG + placement — the data-driven replacement for the retired procedural building unit (the
 * old frontend facade composer + grouped-building factories). A pre-built building (house/store/hospital/…)
 * is a backend COMPOSITION template stamped as per-cell tiles, the SAME path trees use (MAP-MODEL §5,
 * TILE-BACKEND-MIGRATION §4). This module names the composition for a (type,length), reads its footprint
 * + door from the loaded tileset, decides a road facing, and validates a footprint on the grid. The stamp
 * itself is game/runtime/composition.ts's stampBuildingComposition; here is pure lookup + grid reads.
 */
import type { BuildingType } from './buildingTypes'
import type { Facing } from './villageLayout'
import type { IsometricGrid } from './IsometricGrid'
import { resolveComposition } from './tileset/tileset'
import { ASCII_TILESET } from './tileset/asciiTileset'

// ── road / path grounds ──────────────────────────────────────────────────
/** The primary paved road/driveway ground (what the settlement generator carves streets + driveways as). */
export const ROAD_GROUND = 'path_stone'

/** EVERY ground type that reads as a walkable ROAD/PATH a building's footprint may NOT cover. A building
 *  fronts a road from one cell away, so its footprint never sits on the road itself; impassable terrain
 *  (water/lava) is already collision, so only the *walkable* road types need a ground-level exclusion. */
export const ROAD_GROUNDS: ReadonlySet<string> = new Set([
  'road', 'road_center', 'road_edge', 'plaza', 'path_stone', 'path_dirt', 'bridge',
  'snow_path', 'desert_road', 'wooden_planks', 'courtyard_stone',
])

/** True iff a ground type reads as a road/path (buildings never sit on these). */
export function isRoadGround(ground: string | undefined): boolean {
  return ground != null && ROAD_GROUNDS.has(ground)
}

// ── composition catalog ───────────────────────────────────────────────────
// Ground footprint DEPTH (cells perpendicular to the facade, away from the road) per type — MUST match the
// baked composition footprint_h (south facing) so the pure planner reserves exactly what a stamp fills.
export const BUILDING_DEPTH: Readonly<Record<BuildingType, number>> = {
  house: 4,
  'big-house': 4,
  store: 4,
  hospital: 4,
  temple: 4,
  cathedral: 5,
  castle: 6,
}

// The facade LENGTH the editor's place tool uses per type — the baked size (houses default to 4). A house
// also has baked 3/5 variants the generator rolls, but the editor plants one deterministic default.
export const BUILDING_PLACE_LENGTH: Readonly<Record<BuildingType, number>> = {
  house: 4,
  'big-house': 6,
  store: 5,
  hospital: 6,
  temple: 8,
  cathedral: 7,
  castle: 12,
}

/** The backend composition name for a (type,length): `${type}_${length}`, hyphens → underscores
 *  (`big-house`,6 → `big_house_6`). Matches the seeded names in Nebulith.Catalog.BuildingCompositions. */
export function buildingCompositionKind(type: BuildingType, length: number): string {
  return `${type.replace(/-/g, '_')}_${length}`
}

// CW quarter-turns that rotate a south-baked building so its door faces the road: south=0 (door front),
// west=1, north=2, east=3 — the same edge mapping the deleted facade rotation used.
const FACING_ROTATION: Readonly<Record<Facing, number>> = { south: 0, west: 1, north: 2, east: 3 }

/** CW quarter-turns to rotate a south-baked building composition so its door faces `facing`. */
export function facingRotation(facing: Facing): number {
  return FACING_ROTATION[facing]
}

/** One 90° CLOCKWISE turn of a footprint offset: a cell at (dx,dy) in a `w`×`h` footprint lands at
 *  (h-1-dy, dx) in the rotated `h`×`w` footprint — the geometry the deleted facade rotation used. Pure. */
function rotateOffsetCW(dx: number, dy: number, w: number, h: number): { dx: number; dy: number; w: number; h: number } {
  return { dx: h - 1 - dy, dy: dx, w: h, h: w }
}

/** Rotate a footprint offset by `rotation` × 90° CW (0–3, negatives/≥4 wrap), returning the offset within
 *  the rotated footprint. Shared by the live stamp (stampComposition) and the save-path expansion so a
 *  building rotates the SAME way live and persisted. Pure. */
export function rotateFootprintOffset(dx: number, dy: number, w: number, h: number, rotation: number): { dx: number; dy: number } {
  let cur = { dx, dy, w, h }
  const k = ((rotation % 4) + 4) % 4
  for (let i = 0; i < k; i++) cur = rotateOffsetCW(cur.dx, cur.dy, cur.w, cur.h)
  return { dx: cur.dx, dy: cur.dy }
}

/** The on-grid footprint (w×h) of a building composition once rotated to `facing`. East/west swap the
 *  south footprint's axes (length↔depth). Null when the composition isn't loaded. */
export function buildingFootprint(kind: string, facing: Facing): { w: number; h: number } | null {
  const comp = resolveComposition(ASCII_TILESET, kind)
  if (!comp) return null
  const swap = facing === 'east' || facing === 'west'
  return swap ? { w: comp.footprint.h, h: comp.footprint.w } : { w: comp.footprint.w, h: comp.footprint.h }
}

/** The south-facing DOOR span of a composition — the level-0 `door` cells' first offset + width — so the
 *  generator can place the walkable entrance + its driveway. Null when the composition isn't loaded or has
 *  no door. Measured along the facade length (dx), matching the generator's `doorCells(facing, rect, door)`. */
export function buildingDoorOffset(kind: string): { x: number; width: number } | null {
  const comp = resolveComposition(ASCII_TILESET, kind)
  if (!comp) return null
  const doors = comp.cells.filter(c => (c.level ?? 0) === 0 && c.label === 'door')
  if (doors.length === 0) return null
  const xs = doors.map(d => d.dx)
  return { x: Math.min(...xs), width: xs.length }
}

// ── placement ──────────────────────────────────────────────────────────────
/** The cardinal direction from (col,row) toward the NEAREST road cell (any road/path ground), so a
 *  hand-placed building fronts a street like a generated one. Defaults to south when the map has no roads. */
export function nearestRoadFacing(grid: IsometricGrid, col: number, row: number): Facing {
  let best: { d: number; facing: Facing } | null = null
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (!isRoadGround(grid.ground[r]?.[c])) continue
      const d = Math.abs(c - col) + Math.abs(r - row)
      if (best && d >= best.d) continue
      const facing: Facing =
        Math.abs(c - col) > Math.abs(r - row) ? (c > col ? 'east' : 'west') : (r >= row ? 'south' : 'north')
      best = { d, facing }
    }
  }
  return best?.facing ?? 'south'
}

/** True iff a building composition of `kind` rotated to `facing` fits with its footprint TOP-LEFT at
 *  (anchorCol,anchorRow): every footprint cell in-bounds, not blocked (trees/water/another building), and
 *  not on a road/path. Conservative over the whole footprint rect — the same rule the retired
 *  canPlaceBuilding used. False when the composition isn't loaded. */
export function canPlaceBuildingComposition(grid: IsometricGrid, kind: string, anchorCol: number, anchorRow: number, facing: Facing): boolean {
  const fp = buildingFootprint(kind, facing)
  if (!fp) return false
  for (let dr = 0; dr < fp.h; dr++) {
    for (let dc = 0; dc < fp.w; dc++) {
      const col = anchorCol + dc
      const row = anchorRow + dr
      if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false
      if (grid.collision[row]?.[col] === 1) return false
      if (isRoadGround(grid.ground[row]?.[col])) return false
    }
  }
  return true
}
