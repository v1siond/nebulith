/**
 * Systematic settlement LAYOUT planner.
 *
 * Given dimensions + an injected RNG, produce a randomized-but-LOGICAL layout: a road network
 * that connects the map's entrances, building PLOTS that line the main street (distributed by
 * type + scaled by settlement size), and — implicitly — the nature regions (everything that is
 * neither road nor building). The same logic scales village → town → city (more roads, more +
 * bigger buildings, fewer trees).
 *
 * PURE: same (dims, sequence of rng() calls) → same layout. No grid mutation, no rendering — so
 * road connectivity + plot validity are unit-testable via flood fill, with NO canvas. The stage
 * generator carves the roads, stamps a building per plot, and fills nature around the rest.
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
export interface VillageLayout {
  /** roads[row][col] — true where a walkable street/path runs. */
  roads: boolean[][]
  plots: Plot[]
  entrances: Entrance[]
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))
const randInt = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1))

// Settlement scaling — cities are denser (more + bigger buildings) than towns than villages.
const HOUSE_RANGE: Record<Settlement, [number, number]> = { village: [2, 3], town: [3, 5], city: [5, 8] }
const BIG_RANGE: Record<Settlement, [number, number]> = { village: [0, 1], town: [1, 2], city: [2, 4] }
const BRANCH_RANGE: Record<Settlement, [number, number]> = { village: [1, 2], town: [2, 3], city: [3, 4] }

// MUST match buildingComposer TYPE_SPECS.baseLength so a plot reserves exactly the facade's
// width (else buildings overlap their neighbours).
const BUILDING_LENGTH: Partial<Record<BuildingType, number>> = { house: 8, 'big-house': 12, store: 10, hospital: 12 }
const lengthOf = (t: BuildingType): number => BUILDING_LENGTH[t] ?? 8

/**
 * The building MIX for a settlement: ALWAYS one store + one hospital (every town has them),
 * plus houses + big buildings scaled by size, shuffled so a street isn't a fixed order.
 * Pure given `rng`.
 */
export function buildingMix(settlement: Settlement, rng: Rng): BuildingType[] {
  const mix: BuildingType[] = ['store', 'hospital']
  const [hl, hh] = HOUSE_RANGE[settlement]
  for (let i = randInt(rng, hl, hh); i > 0; i--) mix.push('house')
  const [bl, bh] = BIG_RANGE[settlement]
  for (let i = randInt(rng, bl, bh); i > 0; i--) mix.push('big-house')
  // Fisher–Yates shuffle with the injected rng.
  for (let i = mix.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[mix[i], mix[j]] = [mix[j], mix[i]]
  }
  return mix
}

/** No road crosses the footprint row, so a building's door isn't planted on a branch street. */
function frontageClear(roads: boolean[][], col: number, len: number, groundRow: number): boolean {
  for (let c = col; c < col + len; c++) if (roads[groundRow]?.[c]) return false
  return true
}

/**
 * Plan a settlement layout. The road skeleton is a main horizontal street (LEFT↔RIGHT
 * entrances) with vertical branches dividing it into blocks; branches that reach an edge add
 * TOP/BOTTOM entrances. Buildings line the row above the main street (doors facing it).
 */
export function planVillage(cols: number, rows: number, rng: Rng, settlement: Settlement = 'village'): VillageLayout {
  const roads: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false))
  const entrances: Entrance[] = []

  // 1. Main street across the middle (2 cells wide) → left + right entrances.
  const mainRow = clamp(Math.round(rows * 0.5 + (rng() - 0.5) * rows * 0.12), 5, rows - 6)
  for (let c = 0; c < cols; c++) {
    roads[mainRow][c] = true
    roads[mainRow + 1][c] = true
  }
  entrances.push({ col: 0, row: mainRow, side: 'left' }, { col: cols - 1, row: mainRow, side: 'right' })

  // 2. Vertical branches → blocks; an edge-reaching branch becomes a top/bottom entrance.
  const [brl, brh] = BRANCH_RANGE[settlement]
  for (let b = randInt(rng, brl, brh); b > 0; b--) {
    const bc = clamp(randInt(rng, Math.round(cols * 0.2), Math.round(cols * 0.8)), 2, cols - 3)
    const toTop = rng() < 0.6
    const toBot = rng() < 0.6
    const top = toTop ? 0 : clamp(randInt(rng, 1, Math.max(1, mainRow - 1)), 0, mainRow)
    const bot = toBot ? rows - 1 : clamp(randInt(rng, mainRow + 2, rows - 2), mainRow, rows - 1)
    for (let r = top; r <= bot; r++) {
      roads[r][bc] = true
      if (bc + 1 < cols) roads[r][bc + 1] = true
    }
    if (toTop) entrances.push({ col: bc, row: 0, side: 'top' })
    if (toBot) entrances.push({ col: bc, row: rows - 1, side: 'bottom' })
  }

  // 3. Plots line the row ABOVE the main street; the facade rises up, door faces the street.
  const plots: Plot[] = []
  const groundRow = mainRow - 1
  let x = randInt(rng, 2, 4)
  for (const type of buildingMix(settlement, rng)) {
    const len = lengthOf(type)
    if (x + len + 1 > cols) break
    if (!frontageClear(roads, x, len, groundRow)) {
      x += 2 // a branch crosses here — skip past it
      continue
    }
    plots.push({ col: x, row: groundRow, type, length: len })
    x += len + randInt(rng, 2, 3)
  }

  return { roads, plots, entrances }
}
