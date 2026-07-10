// LIVE building-editor grid ops — the runtime twin of the PURE geometry in
// engine/buildingEditor.ts. These mutate the running IsometricGrid (assets +
// collision + ground) so the three views (which all read grid.buildings +
// collision + assets) update together. The pure footprint math + placement rule
// stay in engine/buildingEditor; this is the side-effecting stamp/unstamp + the
// live placement reader. Moved out of the game-engine page (stage 5a).
import { type BuildingType } from '@/engine/buildingComposer'
import { type PlacementEnv, buildingCellBlocked, buildingCellTiles, buildingDoorCells, buildingFootprintCells, isRoadGround } from '@/engine/buildingEditor'
import { cellTile } from '@/engine/cellTileset'
import type { GridBuilding, IsometricGrid } from '@/engine/IsometricGrid'
import { buildingCellColor } from '@/engine/stageGenerator'
import { type Facing } from '@/engine/villageLayout'
import { ZONE_PALETTES, ZoneId } from '@/engine/zones'

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
  // The walkable entrance is the FULL door run (a hospital's 2-wide doorway, a cathedral's 3-wide one) —
  // the SAME cells the generator opens, so the drawn door always lands on walkable collision (no
  // walkable-half/blocked-half wide door). A 1-wide door → the single doorCellFor cell.
  const doorSet = new Set(buildingDoorCells(b).map(d => `${d.col},${d.row}`))
  for (const c of cells) {
    if (c.col < 0 || c.row < 0 || c.col >= grid.cols || c.row >= grid.rows) continue
    grid.setGround(c.col, c.row, base) // clean base ground under the footprint (grass)
    // ONE asset per BLOCK: the footprint cell's stacked wall/window/door blocks (level 1..floors) + the
    // roof cap (floors+1). Each block is a height-1 tile lifted to its stack level — the SAME shape a
    // brush-stacked tile has, so a building block extrudes into an iso cube (or a raised 2D/top tile) with
    // zero per-type branches in the draw loop. buildingCellTiles is the shared decomposition.
    for (const t of buildingCellTiles(b, c.col, c.row)) {
      const { char } = cellTile(zone, t.part)
      const color = buildingCellColor(b.type as BuildingType, t.part, b.col)
      const asset = grid.placeAsset([char], c.col, c.row, { type: 'building', blocking: t.blocking, color, heightLevel: t.level })
      // placeAsset's fixed option list doesn't carry these — set them on the returned asset.
      asset.label = t.part
      asset.buildingType = b.type
      asset.height = 1 // ONE block tall per tile; the column's floors come from the stacked levels, not this
    }
    // Cell collision = the footprint-occupancy rule (whole box blocks, the door run stays walkable), the
    // SAME collision the pre-per-block stamp produced. This increment is RENDER-ONLY, so collision must not
    // change: a blocking wall block placed over the door cell (a lintel above the opening) can flip the cell
    // blocked via placeAsset, so we open the door run LAST to keep the entrance walkable. Interior cells
    // carry only a non-blocking roof block, so the OR-of-blocks alone would leave them walkable — the
    // footprint rule blocks the solid box, unchanged.
    grid.setCollision(c.col, c.row, !doorSet.has(`${c.col},${c.row}`))
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
