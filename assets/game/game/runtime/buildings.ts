// LIVE building-editor grid ops — the runtime twin of the PURE geometry in
// engine/buildingEditor.ts. These mutate the running IsometricGrid (assets +
// collision + ground) so the three views (which all read grid.buildings +
// collision + assets) update together. The pure footprint math + placement rule
// stay in engine/buildingEditor; this is the side-effecting stamp/unstamp + the
// live placement reader. Moved out of the game-engine page (stage 5a).
import { type BuildingType } from '@/engine/buildingComposer'
import { type PlacementEnv, buildingCellBlocked, buildingDoorCells, buildingFootprintCells, buildingRect, isRoadGround } from '@/engine/buildingEditor'
import { cellTile } from '@/engine/cellTileset'
import type { GridBuilding, IsometricGrid } from '@/engine/IsometricGrid'
import { buildingCellColor } from '@/engine/stageGenerator'
import { type Facing } from '@/engine/villageLayout'
import { ZONE_PALETTES, ZoneId } from '@/engine/zones'

/**
 * LIVE stamp: write a building's footprint onto the grid — a 'building' asset +
 * collision per cell (door walkable, every other cell blocking) + clean base
 * ground under it. Mirrors stageGenerator.stampFootprintCell. Does NOT touch
 * grid.buildings; the caller owns that array so indices stay stable across edits.
 */
export function stampBuildingCells(grid: IsometricGrid, b: GridBuilding, zone: ZoneId): void {
  const { cells } = buildingFootprintCells(b)
  const rect = buildingRect(b)
  const base = ZONE_PALETTES[zone]?.groundTypes[0] ?? 'grass'
  // The walkable entrance is the FULL door run (a hospital's 2-wide doorway, a cathedral's 3-wide one) —
  // the SAME cells the generator opens + the facade/iso draw, so the drawn door always lands on walkable
  // collision (no walkable-half/blocked-half wide door). A 1-wide door → the single doorCellFor cell.
  const doorSet = new Set(buildingDoorCells(b).map(d => `${d.col},${d.row}`))
  // Wall block height = the facade's body rows (mirrors the generator + facadeToFootprint).
  const floors = Math.max(1, b.cells.filter(r => r.some(k => k === 'wall' || k === 'window' || k === 'door')).length)
  for (const c of cells) {
    if (c.col < 0 || c.row < 0 || c.col >= grid.cols || c.row >= grid.rows) continue
    const isDoor = doorSet.has(`${c.col},${c.row}`)
    const perimeter = c.col === rect.col || c.col === rect.col + rect.w - 1 || c.row === rect.row || c.row === rect.row + rect.h - 1
    // Per-cell tile model: perimeter = WALL (rises `floors` blocks in iso), door = flat walkable, interior =
    // flat ROOF cell. Collision UNCHANGED (whole footprint blocks except the door). Mirrors stampFootprintCell.
    const label = isDoor ? 'door' : perimeter ? 'wall' : 'roof'
    const tile = cellTile(zone, label)
    const color = buildingCellColor(b.type as BuildingType, label, b.col)
    const asset = grid.placeAsset([tile.char], c.col, c.row, { type: 'building', blocking: !isDoor, color })
    // placeAsset's fixed option list doesn't carry these — set them on the returned asset (was the raw push).
    asset.label = label
    asset.buildingType = b.type
    asset.height = label === 'wall' ? floors : 0
    grid.setCollision(c.col, c.row, !isDoor) // door walkable, every other footprint cell blocks
    grid.setGround(c.col, c.row, base)
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
