/**
 * Systematic settlement LAYOUT planner — divide & conquer.
 *
 * Built by SMALL, individually-tested steps, composed by `planVillage`:
 *   1. planRoads   — the street skeleton + the FRONTAGES (a line of buildable cells beside each
 *                    road: both sides of every horizontal street, both sides of every connector).
 *   2. buildingMix — WHICH buildings a settlement must have (≥ counts scale town→city).
 *   3. placePlots  — WHERE each goes: distribute the mix ROUND-ROBIN across all frontages, each
 *                    building FACING its road (facade parallel to it), footprint extruded AWAY.
 *
 * PURE: same (dims, rng() sequence) → same plan. No grid mutation / rendering — connectivity,
 * distribution, facing, and no-overlap are all unit-testable. The stage generator carves the
 * roads, stamps each building ORIENTED by its facing, then fills nature around it.
 */
import { type BuildingType, composeBuilding } from './buildingComposer'
import { clamp, randIntWith as randInt } from '@/lib/math'

export type Rng = () => number
export type Settlement = 'town' | 'city'
/** The direction a building's door/facade FACES — i.e. toward the road it fronts. */
export type Facing = 'south' | 'north' | 'east' | 'west'

export interface Plot {
  /** min-COL of the (oriented) footprint rectangle. */
  col: number
  /** min-ROW of the footprint rectangle. */
  row: number
  type: BuildingType
  /** Road-PARALLEL footprint width (the frontage span). */
  length: number
  /** Ground footprint depth — perpendicular extent (away from the road). Small / square-ish,
   *  DECOUPLED from `height`. The footprint is `length × depth`. */
  depth: number
  /** Facade vertical elevation (iso rise only; NOT the ground footprint). */
  height: number
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
/** A reserved, road-free square block — the town SQUARE. Buildings keep off it; the generator paves
 *  it path_stone and drops ONE big fountain at its centre. `c0/r0` = min-col/min-row, `size` = side. */
export interface PlazaRect {
  c0: number
  r0: number
  size: number
}
export interface VillageLayout {
  roads: boolean[][]
  plots: Plot[]
  entrances: Entrance[]
  /** The central town-square block reserved BEFORE buildings (null if the map is too small to fit one). */
  plaza: PlazaRect | null
}

// Settlement scaling — a city is a much bigger, denser place than a town (more + bigger buildings,
// a denser street grid). The [min, max] count of each.
const HOUSE_RANGE: Record<Settlement, [number, number]> = { town: [4, 6], city: [7, 11] }
const BIG_RANGE: Record<Settlement, [number, number]> = { town: [1, 3], city: [3, 5] }
// Street GRID per settlement: H horizontal × V vertical FULL-SPAN streets that cross into blocks
// (a real neighborhood grid, not a couple of stubs). Clamped by map size in planRoads so each block
// still fits a row of lots between streets. A city's grid is far denser than a town's → many more
// frontages → many more buildings (~4× a town on the same map).
const GRID: Record<Settlement, { h: number; v: number }> = {
  town: { h: 3, v: 3 },
  city: { h: 5, v: 6 },
}

// The town SQUARE: a road-free block reserved dead-centre BEFORE buildings, so houses ring it
// instead of squeezing the fountain into leftovers. A city's square is bigger (grander fountain).
const PLAZA_SIZE: Record<Settlement, number> = { town: 5, city: 7 }

// MUST match buildingComposer TYPE_SPECS.baseLength so a plot reserves exactly the facade width.
const BUILDING_LENGTH: Partial<Record<BuildingType, number>> = { house: 4, 'big-house': 6, store: 5, hospital: 6 }
const lengthOf = (t: BuildingType): number => BUILDING_LENGTH[t] ?? 8

// Realistic lot rules (subdivision design): a SETBACK (front-yard cells between the building and
// the street) and a LOT_GAP (side-yard cells between neighbours). The door faces the road across
// the setback; a driveway crosses it (stamped by the generator).
const SETBACK = 1
// Street width in cells — wider avenues read better than a thin 2-cell path.
const ROAD_W = 4
// Density per settlement: a town is a modest, leafy settlement — tidy side-yard gaps and a low cap
// so it stays small; a city packs the same lots much harder (no per-frontage limit, a far higher
// cap) so it ends up ~4× the town on the same map.
const LOT_GAP_BY: Record<Settlement, [number, number]> = {
  town: [1, 2],
  city: [1, 1], // a city packs its lots tighter than a town (smaller side-yards) → denser blocks
}
const MAX_PER_FRONTAGE: Record<Settlement, number> = { town: 6, city: 99 }
const BUILDING_CAP: Record<Settlement, number> = { town: 18, city: 72 }

// House footprints stay modest + similar so a frontage reads as a TIDY ROW, not a jagged skyline.
const HOUSE_WIDTHS = [3, 3, 4, 4, 4, 5]
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

/** Evenly-spaced positions for `n` full-span 2-wide streets along a `span`, clamped so each leaves a
 *  buildable block + frontage room and never touches the edge or a neighbour. */
function streetLines(span: number, n: number): number[] {
  const out: number[] = []
  for (let i = 1; i <= n; i++) {
    const p = clamp(Math.round((span * i) / (n + 1)), 5, span - 5 - ROAD_W)
    if (!out.some(q => Math.abs(q - p) <= ROAD_W + 2)) out.push(p)
  }
  return out.sort((a, b) => a - b)
}

/**
 * STEP 1 — the road GRID: H horizontal × V vertical FULL-SPAN 2-wide streets that cross into blocks,
 * then a FRONTAGE on BOTH sides of every street (the rows of lots placePlots fills). Grid size is
 * clamped to the map so each block still fits a row of houses between streets.
 */
export function planRoads(cols: number, rows: number, rng: Rng, settlement: Settlement): RoadPlan {
  const roads: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false))
  const entrances: Entrance[] = []
  const g = GRID[settlement]
  // Each block between streets needs the road (ROAD_W) + a lot row on each side (≈ depth 3 + setback 1
  // + buffer) → ~ROAD_W+7 cells of spacing; clamp the grid to the map so blocks never collapse.
  const hN = Math.max(2, Math.min(g.h, Math.floor((rows - 4) / (ROAD_W + 7))))
  const vN = Math.max(2, Math.min(g.v, Math.floor((cols - 4) / (ROAD_W + 7))))
  const streetRows = streetLines(rows, hN)
  const streetCols = streetLines(cols, vN)

  for (const sr of streetRows) {
    for (let c = 0; c < cols; c++) for (let w = 0; w < ROAD_W; w++) roads[sr + w][c] = true
    entrances.push({ col: 0, row: sr, side: 'left' }, { col: cols - 1, row: sr, side: 'right' })
  }
  for (const sc of streetCols) {
    for (let r = 0; r < rows; r++) for (let w = 0; w < ROAD_W; w++) roads[r][sc + w] = true
    entrances.push({ col: sc, row: 0, side: 'top' }, { col: sc, row: rows - 1, side: 'bottom' })
  }

  // Frontages: a row of doors SET BACK from each street (a front-yard cell between the door edge and
  // the street), on BOTH sides, facing it. placePlots fills each into a row; rectClear skips cells
  // over the cross-streets (intersections), so rows break cleanly at corners. Street = [s, s+ROAD_W-1].
  const frontages: Frontage[] = []
  for (const sr of streetRows) {
    frontages.push({ axis: 'col', facing: 'south', doorLine: sr - 1 - SETBACK, away: -1, lo: 1, hi: cols - 1 }) // above, faces down
    frontages.push({ axis: 'col', facing: 'north', doorLine: sr + ROAD_W + SETBACK, away: 1, lo: 1, hi: cols - 1 }) // below, faces up
  }
  for (const sc of streetCols) {
    frontages.push({ axis: 'row', facing: 'east', doorLine: sc - 1 - SETBACK, away: -1, lo: 1, hi: rows - 1 }) // left, faces right
    frontages.push({ axis: 'row', facing: 'west', doorLine: sc + ROAD_W + SETBACK, away: 1, lo: 1, hi: rows - 1 }) // right, faces left
  }

  return { roads, frontages, entrances }
}

interface Rect {
  c0: number
  r0: number
  w: number
  h: number
}

/** The GROUND footprint rect for a building of `len` (road-parallel) × `depth` (perpendicular) at
 *  position `pos` on frontage `f`. Depth — NOT facade height — sets the away-from-road extent, so
 *  collision + lots stay a small footprint while the facade rises tall only in the iso render. */
function footprint(f: Frontage, pos: number, len: number, depth: number): Rect {
  if (f.axis === 'col') {
    // beside a horizontal street: length runs along cols, depth extrudes along rows.
    const r0 = f.away < 0 ? f.doorLine - depth + 1 : f.doorLine
    return { c0: pos, r0, w: len, h: depth }
  }
  // beside a vertical road: length runs along rows, depth extrudes along cols.
  const c0 = f.away < 0 ? f.doorLine - depth + 1 : f.doorLine
  return { c0, r0: pos, w: depth, h: len }
}

/** The footprint expanded by the SETBACK toward the road — the front-yard the planner reserves so
 *  no neighbour lands on the driveway/yard between this building and its street. */
function clearanceRect(foot: Rect, f: Frontage): Rect {
  if (f.axis === 'col') {
    return f.away < 0
      ? { ...foot, h: foot.h + SETBACK } // road below → reserve down toward it
      : { ...foot, r0: foot.r0 - SETBACK, h: foot.h + SETBACK } // road above → reserve up
  }
  return f.away < 0
    ? { ...foot, w: foot.w + SETBACK } // road right → reserve right
    : { ...foot, c0: foot.c0 - SETBACK, w: foot.w + SETBACK } // road left → reserve left
}

/** A rect grown by `n` cells on every side — a candidate must clear this, so a 1-cell no-touch buffer
 *  (filled by trees) always sits between neighbouring buildings; they never abut. */
function expandRect(r: Rect, n: number): Rect {
  return { c0: r.c0 - n, r0: r.r0 - n, w: r.w + 2 * n, h: r.h + 2 * n }
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

/** The nearest-to-CENTRE road-free `size×size` block: try the centred block, then spiral outward
 *  along Chebyshev rings, so the square lands dead-centre when the grid allows and in a block toward
 *  a corner otherwise. Deterministic (no rng). Null when no road-free block of `size` fits. */
function findPlazaSpot(cols: number, rows: number, roads: boolean[][], size: number): PlazaRect | null {
  if (cols < size + 2 || rows < size + 2) return null
  const fits = (c0: number, r0: number): boolean => {
    if (c0 < 1 || r0 < 1 || c0 + size > cols - 1 || r0 + size > rows - 1) return false
    for (let r = r0; r < r0 + size; r++) for (let c = c0; c < c0 + size; c++) if (roads[r]?.[c]) return false
    return true
  }
  const cc = Math.floor((cols - size) / 2)
  const cr = Math.floor((rows - size) / 2)
  for (let radius = 0; radius <= Math.max(cols, rows); radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue // walk only this ring
        if (fits(cc + dc, cr + dr)) return { c0: cc + dc, r0: cr + dr, size }
      }
    }
  }
  return null
}

/**
 * STEP 2.5 — reserve the town SQUARE: a road-free block as close to map CENTRE as possible, sized for
 * the settlement (a city's square is grander), falling back to a smaller square when a dense street
 * grid leaves no room for the big one. Deterministic (no rng). Null only on a map too small for any
 * square — the generator then just skips the fountain.
 */
export function planPlaza(cols: number, rows: number, roads: boolean[][], settlement: Settlement): PlazaRect | null {
  const sizes = [...new Set([PLAZA_SIZE[settlement], 5])] // preferred, then a compact fallback
  const mc = cols / 2
  const mr = rows / 2
  let best: PlazaRect | null = null
  let bestScore = Infinity
  for (const size of sizes) {
    const spot = findPlazaSpot(cols, rows, roads, size)
    if (!spot) continue
    // CENTRALITY wins: pick the spot nearest map centre. The bigger square only beats a smaller, more
    // central one when it's roughly as central (a size/2 bonus), so the grand plaza is used when it
    // fits near centre but we never shove a big square into a far corner over a central small one.
    const dist = Math.max(Math.abs(spot.c0 + size / 2 - mc), Math.abs(spot.r0 + size / 2 - mr))
    const score = dist - size * 0.5
    if (score < bestScore) {
      bestScore = score
      best = spot
    }
  }
  return best
}

/**
 * STEP 3 — FILL every frontage with a tidy ROW of lots: walk it end-to-end placing buildings back
 * to back (uniform-ish width + a side-yard gap), each SET BACK behind a front yard and FACING its
 * street. Store + hospital + a few big-houses are placed first (every settlement gets them), the
 * rest fill as houses; where an essential doesn't fit a spot, a house fills it instead so rows never
 * starve. rectClear skips cells over cross-streets, so rows break cleanly at intersections. Pure.
 */
export function placePlots(roads: boolean[][], frontages: Frontage[], cols: number, rows: number, rng: Rng, settlement: Settlement, reserved: PlazaRect | null = null): Plot[] {
  const plots: Plot[] = []
  if (frontages.length === 0) return plots
  const occ = roads.map(r => r.slice())
  // Pre-mark the reserved town SQUARE as occupied so the round-robin fill builds houses AROUND it —
  // the square is a focal landmark, claimed FIRST, not squeezed into leftovers. No extra moat needed:
  // every candidate already clears its own footprint+1 buffer against `occ`, so houses keep off it.
  if (reserved) {
    for (let r = reserved.r0; r < reserved.r0 + reserved.size; r++)
      for (let c = reserved.c0; c < reserved.c0 + reserved.size; c++)
        if (r >= 0 && r < rows && c >= 0 && c < cols) occ[r][c] = true
  }
  const cap = BUILDING_CAP[settlement]
  const maxPer = MAX_PER_FRONTAGE[settlement]
  const [gapLo, gapHi] = LOT_GAP_BY[settlement]
  const pending: BuildingType[] = ['store', 'hospital']
  for (let i = randInt(rng, ...BIG_RANGE[settlement]); i > 0; i--) pending.push('big-house')

  // Store + hospital ALWAYS go on the TOP horizontal street, facing FRONT (south = door toward the
  // viewer) — good civic practice and it guarantees their labeled fronts show in 2D. Place them there
  // first; anything that can't fit stays in `pending` and the normal fill guarantees it elsewhere.
  const topSouth = frontages
    .filter(f => f.facing === 'south')
    .sort((a, b) => a.doorLine - b.doorLine)[0]
  if (topSouth) {
    let pos = topSouth.lo + 1
    for (const type of ['store', 'hospital'] as BuildingType[]) {
      let guard = 0
      while (pos + 2 <= topSouth.hi && guard++ < 1000) {
        const len = plotWidth(type, rng)
        const composed = composeBuilding({ type, length: len })
        const foot = footprint(topSouth, pos, len, composed.depth)
        const reserve = expandRect(foot, 1)
        if (!rectClear(reserve, occ, cols, rows)) { pos += 1; continue }
        for (let r = Math.max(0, reserve.r0); r < Math.min(rows, reserve.r0 + reserve.h); r++)
          for (let c = Math.max(0, reserve.c0); c < Math.min(cols, reserve.c0 + reserve.w); c++) occ[r][c] = true
        plots.push({ col: foot.c0, row: foot.r0, type, length: len, depth: composed.depth, height: composed.height, facing: topSouth.facing })
        pos += len + randInt(rng, gapLo, gapHi)
        const idx = pending.indexOf(type)
        if (idx >= 0) pending.splice(idx, 1) // placed up front → don't re-place in the fill loop
        break
      }
    }
  }

  // Visit frontages SHUFFLED so a capped settlement (a modest town) spreads its houses across
  // the whole grid instead of packing the first streets.
  const order = frontages.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }

  for (const fi of order) {
    if (plots.length >= cap) break
    const f = frontages[fi]
    let pos = f.lo + randInt(rng, 0, 1)
    let count = 0
    let guard = 0
    while (pos + 2 <= f.hi && count < maxPer && plots.length < cap && guard++ < 1000) {
      const want = pending[0]
      // Try the wanted essential/big first, then fall back to a house at this spot.
      const tryTypes: BuildingType[] = want ? [want, 'house'] : ['house']
      let placed = false
      for (const type of tryTypes) {
        const len = plotWidth(type, rng)
        const composed = composeBuilding({ type, length: len })
        const foot = footprint(f, pos, len, composed.depth)
        // Reserve the footprint + a 1-cell margin on every side (the road-side cell is the setback
        // yard, never the street; the other sides are the no-touch buffer trees fill) so no two
        // buildings ever abut.
        const reserve = expandRect(foot, 1)
        if (!rectClear(reserve, occ, cols, rows)) continue
        for (let r = Math.max(0, reserve.r0); r < Math.min(rows, reserve.r0 + reserve.h); r++)
          for (let c = Math.max(0, reserve.c0); c < Math.min(cols, reserve.c0 + reserve.w); c++) occ[r][c] = true
        plots.push({ col: foot.c0, row: foot.r0, type, length: len, depth: composed.depth, height: composed.height, facing: f.facing })
        if (type === want) pending.shift()
        pos += len + randInt(rng, gapLo, gapHi)
        count++
        placed = true
        break
      }
      if (!placed) pos += 1
    }
  }
  return plots
}

/** Compose the steps: road GRID → reserve the central SQUARE → fill frontages with rows of lots
 *  AROUND the square. The pipeline the generator stamps (it paves the square + drops ONE fountain). */
export function planVillage(cols: number, rows: number, rng: Rng, settlement: Settlement = 'town'): VillageLayout {
  const { roads, frontages, entrances } = planRoads(cols, rows, rng, settlement)
  const plaza = planPlaza(cols, rows, roads, settlement)
  const plots = placePlots(roads, frontages, cols, rows, rng, settlement, plaza)
  return { roads, plots, entrances, plaza }
}
