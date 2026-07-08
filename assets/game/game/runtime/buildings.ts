// LIVE building-editor grid ops — the runtime twin of the PURE geometry in
// engine/buildingEditor.ts. These mutate the running IsometricGrid (assets +
// collision + ground) so the three views (which all read grid.buildings +
// collision + assets) update together. The pure footprint math + placement rule
// stay in engine/buildingEditor; this is the side-effecting stamp/unstamp + the
// live placement reader. Moved out of the game-engine page (stage 5a).
import { type BuildingType } from '@/engine/buildingComposer'
import { type PlacementEnv, buildingCellBlocked, buildingFootprintCells, buildingRect } from '@/engine/buildingEditor'
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
  const { cells, door } = buildingFootprintCells(b)
  const rect = buildingRect(b)
  const base = ZONE_PALETTES[zone]?.groundTypes[0] ?? 'grass'
  // Wall block height = the facade's body rows (mirrors the generator + facadeToFootprint).
  const floors = Math.max(1, b.cells.filter(r => r.some(k => k === 'wall' || k === 'window' || k === 'door')).length)
  for (const c of cells) {
    if (c.col < 0 || c.row < 0 || c.col >= grid.cols || c.row >= grid.rows) continue
    const isDoor = c.col === door.col && c.row === door.row
    const perimeter = c.col === rect.col || c.col === rect.col + rect.w - 1 || c.row === rect.row || c.row === rect.row + rect.h - 1
    // Per-cell tile model: perimeter = WALL (rises `floors` blocks in iso), door = flat walkable, interior =
    // flat ROOF cell. Collision UNCHANGED (whole footprint blocks except the door). Mirrors stampFootprintCell.
    const label = isDoor ? 'door' : perimeter ? 'wall' : 'roof'
    const tile = cellTile(zone, label)
    const color = buildingCellColor(b.type as BuildingType, label, b.col)
    grid.assets.push({
      art: [tile.char],
      col: c.col,
      row: c.row,
      type: 'building',
      blocking: !isDoor,
      color,
      label,
      buildingType: b.type,
      height: label === 'wall' ? floors : 0,
    })
    grid.collision[c.row][c.col] = isDoor ? 0 : 1
    grid.ground[c.row][c.col] = base
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
  grid.assets = grid.assets.filter(a => !(a.type === 'building' && keys.has(`${a.col},${a.row}`)))
  for (const c of cells) {
    if (c.col < 0 || c.row < 0 || c.col >= grid.cols || c.row >= grid.rows) continue
    grid.collision[c.row][c.col] = 0
    grid.ground[c.row][c.col] = base
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

/** The cardinal direction from (col,row) toward the NEAREST road cell (path_stone),
 *  so a manually-placed building fronts a street like a generated one. Defaults to
 *  south when the map has no roads. */
export function nearestRoadFacing(grid: IsometricGrid, col: number, row: number): Facing {
  let best: { d: number; facing: Facing } | null = null
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (grid.ground[r]?.[c] !== 'path_stone') continue
      const d = Math.abs(c - col) + Math.abs(r - row)
      if (best && d >= best.d) continue
      const facing: Facing =
        Math.abs(c - col) > Math.abs(r - row) ? (c > col ? 'east' : 'west') : (r >= row ? 'south' : 'north')
      best = { d, facing }
    }
  }
  return best?.facing ?? 'south'
}
