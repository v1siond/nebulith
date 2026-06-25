/**
 * Systematic settlement LAYOUT planner — divide & conquer.
 *
 * The plan is built by SMALL, individually-solid + individually-tested steps, then composed
 * sequentially by `planVillage`:
 *   1. planRoads   — the street skeleton (two frontages joined by a connector) + entrances.
 *   2. buildingMix — WHICH buildings a settlement must have (≥ counts scale village→town→city).
 *   3. placePlots  — WHERE each building goes: distribute the mix along the road frontages.
 * (Nature/ornaments/etc. are added by the stage generator AROUND this plan — added later.)
 *
 * PURE: same (dims, sequence of rng() calls) → same plan. No grid mutation, no rendering — so
 * road connectivity + plot validity + the per-type guarantees are unit-testable via flood fill
 * with NO canvas. The stage generator carves the roads, stamps a building per plot, fills nature.
 */
import type { BuildingType } from './buildingComposer'

export type Rng = () => number
export type Settlement = 'village' | 'town' | 'city'

export interface Plot {
  /** left column of the footprint. */
  col: number
  /** GROUND row — the facade rises UP from here; the door faces the street one row below. */
  row: number
  type: BuildingType
  length: number
}
export interface Entrance {
  col: number
  row: number
  side: 'left' | 'right' | 'top' | 'bottom'
}
/** The road skeleton + the rows where buildings may stand (just above each horizontal street). */
export interface RoadPlan {
  roads: boolean[][]
  frontages: number[]
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
  // Houses + big buildings, shuffled for variety...
  const rest: BuildingType[] = []
  const [hl, hh] = HOUSE_RANGE[settlement]
  for (let i = randInt(rng, hl, hh); i > 0; i--) rest.push('house')
  const [bl, bh] = BIG_RANGE[settlement]
  for (let i = randInt(rng, bl, bh); i > 0; i--) rest.push('big-house')
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  // ...with the store + hospital FIRST so placePlots always gets to them (guaranteed essentials).
  return ['store', 'hospital', ...rest]
}

/**
 * STEP 1 — the road skeleton: two horizontal streets (an upper + a lower) joined by vertical
 * connector(s), giving TWO building frontages so a settlement's buildings actually fit. Streets
 * reach the left + right edges (entrances); connectors that reach an edge add top/bottom ones.
 */
export function planRoads(cols: number, rows: number, rng: Rng, settlement: Settlement): RoadPlan {
  const roads: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false))
  const entrances: Entrance[] = []

  // N evenly-spaced horizontal streets, capped by what the map height fits (each frontage
  // needs ~9 rows of headroom for the buildings rising above it).
  const maxStreets = Math.max(1, Math.floor((rows - 6) / 9))
  const n = Math.min(STREET_COUNT[settlement], maxStreets)
  const streets: number[] = []
  for (let i = 0; i < n; i++) {
    const frac = (i + 1) / (n + 1)
    streets.push(clamp(Math.round(rows * frac + (rng() - 0.5) * rows * 0.03), 8, rows - 5))
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

  // Vertical connector(s) span first→last street, joining EVERY street into one network
  // (and may run to the top/bottom edges → entrances).
  const [cl, ch] = CONNECTOR_RANGE[settlement]
  const firstStreet = streets[0]
  const lastStreet = streets[streets.length - 1]
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
  }

  // Frontages: the row directly above each street (door faces the street below).
  return { roads, frontages: streets.map(s => s - 1), entrances }
}

/** No road crosses the building's footprint row, so a door isn't planted on a connector. */
function frontageClear(roads: boolean[][], col: number, len: number, groundRow: number): boolean {
  for (let c = col; c < col + len; c++) if (roads[groundRow]?.[c]) return false
  return true
}

/**
 * STEP 3 — WHERE the buildings go: walk each frontage left→right, placing the next building
 * from the mix wherever it fits, ADVANCING past a connector crossing rather than dropping the
 * building. Frontage 1 fills, then frontage 2 — so the whole mix is placed as long as there's
 * room across both streets. Pure.
 */
export function placePlots(roads: boolean[][], frontages: number[], cols: number, mix: BuildingType[], rng: Rng): Plot[] {
  const plots: Plot[] = []
  let mi = 0
  for (const groundRow of frontages) {
    let x = randInt(rng, 2, 4)
    while (mi < mix.length) {
      const type = mix[mi]
      const len = plotWidth(type, rng)
      while (x + len + 1 <= cols && !frontageClear(roads, x, len, groundRow)) x += 1 // step past a connector
      if (x + len + 1 > cols) break // frontage full → move to the next frontage
      plots.push({ col: x, row: groundRow, type, length: len })
      x += len + randInt(rng, 2, 3)
      mi++
    }
  }
  return plots
}

/** Compose the steps: roads → mix → plots. The sequential pipeline the generator stamps. */
export function planVillage(cols: number, rows: number, rng: Rng, settlement: Settlement = 'village'): VillageLayout {
  const { roads, frontages, entrances } = planRoads(cols, rows, rng, settlement)
  const plots = placePlots(roads, frontages, cols, buildingMix(settlement, rng), rng)
  return { roads, plots, entrances }
}
