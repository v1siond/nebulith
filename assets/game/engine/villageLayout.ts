/**
 * Systematic settlement LAYOUT planner — divide & conquer.
 *
 * Built by SMALL, individually-tested steps, composed by `planVillage`:
 *   1. planRoads   — the street skeleton + the FRONTAGES (a line of buildable cells beside each
 *                    road: both sides of every horizontal street, both sides of every connector).
 *   2. buildingMix — WHICH buildings a settlement must have (≥ counts scale village→town→city).
 *   3. placePlots  — WHERE each goes: distribute the mix ROUND-ROBIN across all frontages, each
 *                    building FACING its road (facade parallel to it), footprint extruded AWAY.
 *
 * PURE: same (dims, rng() sequence) → same plan. No grid mutation / rendering — connectivity,
 * distribution, facing, and no-overlap are all unit-testable. The stage generator carves the
 * roads, stamps each building ORIENTED by its facing, then fills nature around it.
 */
import { type BuildingType, composeBuilding } from './buildingComposer'

export type Rng = () => number
export type Settlement = 'village' | 'town' | 'city'
/** The direction a building's door/facade FACES — i.e. toward the road it fronts. */
export type Facing = 'south' | 'north' | 'east' | 'west'

export interface Plot {
  /** min-COL of the (oriented) footprint rectangle. */
  col: number
  /** min-ROW of the footprint rectangle. */
  row: number
  type: BuildingType
  length: number
  facing: Facing
}
export interface Entrance {
  col: number
  row: number
  side: 'left' | 'right' | 'top' | 'bottom'
}
/** A line of cells beside a road where buildings stand, facing the road (facade parallel). */
export interface Frontage {
  /** Which coord varies as buildings line up: 'col' = beside a horizontal street, 'row' = beside a vertical road. */
  axis: 'col' | 'row'
  facing: Facing
  /** The row (axis 'col') or col (axis 'row') the DOORS sit on, one cell off the road. */
  doorLine: number
  /** Sign the footprint extrudes PERPENDICULAR to the frontage, away from the road (−1 or +1). */
  away: -1 | 1
  /** First / last (exclusive) position along the axis. */
  lo: number
  hi: number
}
export interface RoadPlan {
  roads: boolean[][]
  frontages: Frontage[]
  entrances: Entrance[]
}
export interface VillageLayout {
  roads: boolean[][]
  plots: Plot[]
  entrances: Entrance[]
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))
const randInt = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1))

// Settlement scaling — cities are denser (more + bigger buildings, more roads) than towns
// than villages. The [min, max] count of each.
const HOUSE_RANGE: Record<Settlement, [number, number]> = { village: [2, 3], town: [4, 6], city: [7, 11] }
const BIG_RANGE: Record<Settlement, [number, number]> = { village: [0, 1], town: [1, 3], city: [3, 5] }
const CONNECTOR_RANGE: Record<Settlement, [number, number]> = { village: [1, 1], town: [1, 2], city: [2, 3] }
// Horizontal streets = building frontages. Cities get more so more buildings fit (capacity,
// not just mix, scales). Clamped by map height in planRoads.
const STREET_COUNT: Record<Settlement, number> = { village: 2, town: 2, city: 3 }

// MUST match buildingComposer TYPE_SPECS.baseLength so a plot reserves exactly the facade width.
const BUILDING_LENGTH: Partial<Record<BuildingType, number>> = { house: 4, 'big-house': 6, store: 5, hospital: 6 }
const lengthOf = (t: BuildingType): number => BUILDING_LENGTH[t] ?? 8

// House footprints VARY (2 blocks min → up to 7); other types keep their fixed type width.
const HOUSE_WIDTHS = [2, 3, 3, 4, 4, 5, 6, 7]
const plotWidth = (type: BuildingType, rng: Rng): number =>
  type === 'house' ? HOUSE_WIDTHS[Math.floor(rng() * HOUSE_WIDTHS.length)] : lengthOf(type)

/**
 * STEP 2 — the building MIX: ALWAYS one store + one hospital (every settlement has them), plus
 * houses + big buildings scaled by size, shuffled so a street isn't a fixed order. Pure.
 */
export function buildingMix(settlement: Settlement, rng: Rng): BuildingType[] {
  const rest: BuildingType[] = []
  const [hl, hh] = HOUSE_RANGE[settlement]
  for (let i = randInt(rng, hl, hh); i > 0; i--) rest.push('house')
  const [bl, bh] = BIG_RANGE[settlement]
  for (let i = randInt(rng, bl, bh); i > 0; i--) rest.push('big-house')
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  // store + hospital FIRST so the round-robin always reaches the guaranteed essentials.
  return ['store', 'hospital', ...rest]
}

interface Connector {
  bc: number
  top: number
  bot: number
}

/**
 * STEP 1 — the road skeleton: N horizontal streets joined by vertical connector(s), then a
 * FRONTAGE on BOTH sides of every street + BOTH sides of every connector — so buildings can line
 * all of them and face the road. Streets reach the edges (entrances); connectors may too.
 */
export function planRoads(cols: number, rows: number, rng: Rng, settlement: Settlement): RoadPlan {
  const roads: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false))
  const entrances: Entrance[] = []

  // N evenly-spaced horizontal streets, capped by map height (≈9 rows headroom per frontage side).
  const maxStreets = Math.max(1, Math.floor((rows - 6) / 9))
  const n = Math.min(STREET_COUNT[settlement], maxStreets)
  const streets: number[] = []
  for (let i = 0; i < n; i++) {
    const frac = (i + 1) / (n + 1)
    streets.push(clamp(Math.round(rows * frac + (rng() - 0.5) * rows * 0.03), 8, rows - 6))
  }
  streets.sort((a, b) => a - b)

  // Carve each street (2 cells wide, edge to edge) → left + right entrances.
  for (const sr of streets) {
    for (let c = 0; c < cols; c++) {
      roads[sr][c] = true
      roads[sr + 1][c] = true
    }
    entrances.push({ col: 0, row: sr, side: 'left' }, { col: cols - 1, row: sr, side: 'right' })
  }

  // Vertical connector(s) span first→last street (joining the network), maybe to an edge.
  const [cl, ch] = CONNECTOR_RANGE[settlement]
  const firstStreet = streets[0]
  const lastStreet = streets[streets.length - 1]
  const connectors: Connector[] = []
  for (let k = randInt(rng, cl, ch); k > 0; k--) {
    const bc = clamp(randInt(rng, Math.round(cols * 0.2), Math.round(cols * 0.8)), 2, cols - 3)
    const toTop = rng() < 0.5
    const toBot = rng() < 0.5
    const top = toTop ? 0 : firstStreet
    const bot = toBot ? rows - 1 : lastStreet + 1
    for (let r = top; r <= bot; r++) {
      roads[r][bc] = true
      if (bc + 1 < cols) roads[r][bc + 1] = true
    }
    if (toTop) entrances.push({ col: bc, row: 0, side: 'top' })
    if (toBot) entrances.push({ col: bc, row: rows - 1, side: 'bottom' })
    connectors.push({ bc, top, bot })
  }

  // Frontages: a line of doors one cell off each road, on BOTH sides, facing it.
  const frontages: Frontage[] = []
  for (const sr of streets) {
    frontages.push({ axis: 'col', facing: 'south', doorLine: sr - 1, away: -1, lo: 1, hi: cols - 1 }) // above, faces down
    frontages.push({ axis: 'col', facing: 'north', doorLine: sr + 2, away: 1, lo: 1, hi: cols - 1 }) // below, faces up
  }
  for (const { bc, top, bot } of connectors) {
    frontages.push({ axis: 'row', facing: 'east', doorLine: bc - 1, away: -1, lo: top + 1, hi: bot }) // left, faces right
    frontages.push({ axis: 'row', facing: 'west', doorLine: bc + 2, away: 1, lo: top + 1, hi: bot }) // right, faces left
  }

  return { roads, frontages, entrances }
}

interface Rect {
  c0: number
  r0: number
  w: number
  h: number
}

/** The footprint rect for a building of `len` × `height` at position `pos` on frontage `f`. */
function footprint(f: Frontage, pos: number, len: number, height: number): Rect {
  if (f.axis === 'col') {
    // beside a horizontal street: length runs along cols, height extrudes along rows.
    const r0 = f.away < 0 ? f.doorLine - height + 1 : f.doorLine
    return { c0: pos, r0, w: len, h: height }
  }
  // beside a vertical road: length runs along rows, height extrudes along cols.
  const c0 = f.away < 0 ? f.doorLine - height + 1 : f.doorLine
  return { c0, r0: pos, w: height, h: len }
}

/** True when the whole rect is in-bounds and free of roads / already-placed buildings. */
function rectClear(rect: Rect, occ: boolean[][], cols: number, rows: number): boolean {
  if (rect.c0 < 0 || rect.r0 < 0 || rect.c0 + rect.w > cols || rect.r0 + rect.h > rows) return false
  for (let r = rect.r0; r < rect.r0 + rect.h; r++) {
    for (let c = rect.c0; c < rect.c0 + rect.w; c++) {
      if (occ[r]?.[c]) return false
    }
  }
  return true
}

/**
 * STEP 3 — distribute the mix ROUND-ROBIN across ALL frontages so buildings populate every road
 * (not one street), each placed where its FACING footprint is clear of roads + other buildings
 * (so corners/intersections are skipped automatically). Pure.
 */
export function placePlots(roads: boolean[][], frontages: Frontage[], cols: number, rows: number, mix: BuildingType[], rng: Rng): Plot[] {
  const plots: Plot[] = []
  if (frontages.length === 0) return plots
  const occ = roads.map(r => r.slice())
  const cursors = frontages.map(f => f.lo + randInt(rng, 0, 2))
  const dead = frontages.map(() => false)
  let mi = 0
  let fi = 0
  let guard = 0
  while (mi < mix.length && dead.some(d => !d) && guard++ < 20000) {
    const idx = fi++ % frontages.length
    if (dead[idx]) continue
    const f = frontages[idx]
    const type = mix[mi]
    const len = plotWidth(type, rng)
    const height = composeBuilding({ type, length: len }).height
    let pos = cursors[idx]
    let rect: Rect | null = null
    while (pos + len <= f.hi) {
      const cand = footprint(f, pos, len, height)
      if (rectClear(cand, occ, cols, rows)) {
        rect = cand
        break
      }
      pos += 1
    }
    if (!rect) {
      dead[idx] = true
      continue
    }
    for (let r = rect.r0; r < rect.r0 + rect.h; r++) {
      for (let c = rect.c0; c < rect.c0 + rect.w; c++) occ[r][c] = true
    }
    plots.push({ col: rect.c0, row: rect.r0, type, length: len, facing: f.facing })
    cursors[idx] = pos + len + randInt(rng, 1, 2)
    mi++
  }
  return plots
}

/** Compose the steps: roads → mix → plots. The sequential pipeline the generator stamps. */
export function planVillage(cols: number, rows: number, rng: Rng, settlement: Settlement = 'village'): VillageLayout {
  const { roads, frontages, entrances } = planRoads(cols, rows, rng, settlement)
  const plots = placePlots(roads, frontages, cols, rows, buildingMix(settlement, rng), rng)
  return { roads, plots, entrances }
}
