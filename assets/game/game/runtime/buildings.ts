// LIVE building-editor grid ops — the runtime twin of the PURE geometry in
// engine/buildingEditor.ts. These mutate the running IsometricGrid (assets +
// collision + ground) so the three views (which all read grid.buildings +
// collision + assets) update together. The pure footprint math + placement rule
// stay in engine/buildingEditor; this is the side-effecting stamp/unstamp + the
// live placement reader. Moved out of the game-engine page (stage 5a).
import { type BuildingType } from '@/engine/buildingComposer'
import { type PlacementEnv, buildingCellBlocked, buildingCellTiles, buildingFootprintCells, isRoadGround } from '@/engine/buildingEditor'
import { resolveTile } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import type { GridBuilding, IsometricGrid } from '@/engine/IsometricGrid'
import { buildingCellColor } from '@/engine/stageGenerator'
import { type Facing } from '@/engine/villageLayout'
import { ZONE_PALETTES, ZoneId } from '@/engine/zones'

/** The distinct INDOOR floor stamped under a building's interior cells (backend terrain tile), so a revealed
 *  hollow interior reads as a room you can stand in — not the grass/path the building sits on. */
const BUILDING_FLOOR = 'wooden_planks'

/**
 * LIVE stamp: write a building's footprint onto the grid as PER-BLOCK TILES — the building-is-just-tiles
 * model. A BUILDING is not a special render unit: each footprint CELL decomposes (buildingCellTiles) into
 * one TILE per BLOCK — wall/window/door blocks rising its floors, a roof cap on top — and we place ONE
 * `type:'building'` asset per block. Those blocks then render through the SAME per-block asset path as any
 * stacked tile in all three views (no building-specific drawer). Plus per-cell collision (the door run
 * walkable, every other footprint cell blocking) + clean base ground under it. Does NOT touch
 * grid.buildings; the caller owns that array (the building's metadata for whole-building ops) so indices
 * stay stable across edits.
 */
export function stampBuildingCells(grid: IsometricGrid, b: GridBuilding, zone: ZoneId): void {
  const { cells } = buildingFootprintCells(b)
  const base = ZONE_PALETTES[zone]?.groundTypes[0] ?? 'grass'
  for (const c of cells) {
    if (c.col < 0 || c.row < 0 || c.col >= grid.cols || c.row >= grid.rows) continue
    const cellTiles = buildingCellTiles(b, c.col, c.row)
    // INTERIOR cells (no wall/window/door block — only a roof cap high above) get a distinct indoor FLOOR so a
    // revealed interior reads as a room you can stand in; perimeter (wall/window/door) cells keep the zone base.
    const hasFacade = cellTiles.some(t => t.part === 'wall' || t.part === 'window' || t.part === 'door')
    grid.setGround(c.col, c.row, hasFacade ? base : BUILDING_FLOOR)
    // ONE asset per BLOCK: the footprint cell's stacked wall/window/door blocks + the roof cap. Each block is a
    // height-1 tile lifted to its stack level — the SAME shape a brush-stacked tile has (one generic draw path).
    for (const t of cellTiles) {
      const { char } = resolveTile(ASCII_TILESET, zone, t.part) // LOADS the glyph from the DB tileset, not hardcoded
      const color = buildingCellColor(b.type as BuildingType, t.part, b.col)
      const asset = grid.placeAsset([char], c.col, c.row, { type: 'building', blocking: t.blocking, color, heightLevel: t.level })
      asset.label = t.part // placeAsset's fixed option list doesn't carry these — set them on the returned asset.
      asset.buildingType = b.type
      asset.height = 1 // ONE block tall per tile; the column's floors come from the stacked levels, not this
    }
    // HOLLOW collision: a cell blocks only if it has a GROUND-LEVEL (level 0) blocking block — i.e. a WALL. The
    // door (walkable level-0 block) and the INTERIOR (only a high, non-blocking roof cap) stay WALKABLE, so the
    // hero + units can stand INSIDE the building. (Was a solid footprint box; now the real hollow shell requested.)
    grid.setCollision(c.col, c.row, cellTiles.some(t => (t.level ?? 0) === 0 && t.blocking))
  }
}

/**
 * LIVE unstamp (inverse of stampBuildingCells): drop the building assets on the
 * footprint, free collision back to walkable, and reset the ground to the zone
 * base (grass) — so a deleted/moved building leaves walkable grass behind.
 */
export function unstampBuildingCells(grid: IsometricGrid, b: GridBuilding, zone: ZoneId): void {
  const { cells } = buildingFootprintCells(b)
  const base = ZONE_PALETTES[zone]?.groundTypes[0] ?? 'grass'
  const keys = new Set(cells.map(c => `${c.col},${c.row}`))
  grid.removeAssetsWhere(a => a.type === 'building' && keys.has(`${a.col},${a.row}`))
  for (const c of cells) {
    if (c.col < 0 || c.row < 0 || c.col >= grid.cols || c.row >= grid.rows) continue
    grid.setCollision(c.col, c.row, false)
    grid.setGround(c.col, c.row, base)
  }
}

/**
 * The placement environment for the editor. A footprint cell is blocked only when it is
 * truly occupied — it overlaps ANOTHER building's footprint, carries collision (trees,
 * water, lava, features, or any blocking asset), or is a road — except the cells in
 * `ignore` (the moving/rotating building's own footprint, about to be vacated). Any other
 * walkable, non-road cell is free: bare grass, an interior floor, or a cell that only holds
 * non-blocking ground decor. Pure-ish reader over the live grid; the policy itself lives in
 * the pure `buildingCellBlocked` so it stays unit-testable.
 */
export function buildingPlacementEnv(grid: IsometricGrid, ignoreIndex: number, ignore: ReadonlySet<string>): PlacementEnv {
  const others = new Set<string>()
  grid.buildings.forEach((b, i) => {
    if (i === ignoreIndex) return
    for (const c of buildingFootprintCells(b).cells) others.add(`${c.col},${c.row}`)
  })
  return {
    cols: grid.cols,
    rows: grid.rows,
    blocked: (col, row) => {
      const key = `${col},${row}`
      if (ignore.has(key)) return false
      return buildingCellBlocked({
        occupied: others.has(key), // another building's footprint (incl. its door)
        collision: grid.collision[row]?.[col] === 1, // trees / water / lava / features / blocking assets
        ground: grid.ground[row]?.[col] ?? '',
      })
    },
  }
}

/** The cardinal direction from (col,row) toward the NEAREST road cell (any road/path ground —
 *  road_center/road_edge/path_stone/…, so it works on generated AND legacy-preset maps), so a
 *  manually-placed building fronts a street like a generated one. Defaults to south when the map
 *  has no roads. */
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
