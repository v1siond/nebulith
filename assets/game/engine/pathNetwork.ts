/**
 * PATHS FIRST: a map's route network, planned before anything is planted.
 *
 * Alexander, 2026-09-11: *"I expect maps to have an entrance and exit, sometimes it'll be the same place to enter
 * and leave, others we must have multiple pathways with different exists ... we should always have paths firsts,
 * and ensure the rest is build around it"*, with Zelda, Pokemon and Chrono Trigger as the reference.
 *
 * TWO numbers say what a map is, and the backend serves both. EXITS is how many gates it has on its border, the
 * places a connector hands you to another map, and the first of them is the entrance: *"sometimes it'll be the same
 * place to enter and leave"* is one exit. PATHWAYS is how many paths run inside it. A pathway past the last exit has
 * nowhere to go, so it stops in the map, which is his cave: *"1 exit and 3 pathways to simulate entrance"* is one way
 * back out and two branches that end at a room, and *"just 1 exit no pathway"* is the end of the cave. Those stops
 * are where a closed section, or one that opens when you do something, belongs.
 *
 * This only DECIDES cells. The layouts pave them and grow the place around them.
 */
import type { Rng } from '@/lib/math'
import { randIntWith } from '@/lib/math'

export interface RouteCell { col: number; row: number }
export type Side = 'south' | 'north' | 'west' | 'east'

/** How many exits, or how many pathways. The counts the backend offers. */
export type RouteCount = 1 | 2 | 3 | 4
export const ROUTE_COUNTS: readonly RouteCount[] = [1, 2, 3, 4]

/** What the two served options come to for one map. */
export interface Ways { exits: RouteCount; pathways: RouteCount }

/** Where a path leaves the map: the edge cells it runs off by, and the cell just inside. */
export interface Gate { side: Side; cells: RouteCell[]; inside: RouteCell }

export interface RoutePlan {
  /** The way in, always on the near edge. It is `gates[0]`. */
  entrance: Gate
  /** Every gate on the border, the entrance included: one per exit. */
  gates: Gate[]
  /** Where a pathway that is not an exit stops, inside the map. */
  deadEnds: RouteCell[]
  /** Where the paths meet. */
  hub: RouteCell
  /** Every cell the network covers, `col,row` keys. */
  cells: Set<string>
  /**
   * The one-cell CENTRE LINE of the same network.
   *
   * A cave gallery should pinch and open along its length (a chokepoint is what makes a cave read as a cave,
   * and Warcraft 3's map guidance is blunt about them mattering), but narrowing a corridor by hand is how you
   * sever a leg by accident. With the spine carved ALWAYS and the rest of the band carved only where the map
   * wants width, connectivity holds by construction and the width is free to vary.
   */
  spine: Set<string>
}

/** The sides the gates take, in order, the entrance first. A third gate takes two of the remaining sides at random. */
const GATE_SIDES: Readonly<Record<RouteCount, (rand: Rng) => Side[]>> = {
  1: () => ['south'],
  2: () => ['south', 'north'],
  3: rand => {
    const others: Side[] = ['north', 'west', 'east']
    others.splice(randIntWith(rand, 0, others.length - 1), 1)
    return ['south', ...others]
  },
  4: () => ['south', 'north', 'west', 'east'],
}

/** A count as served: `"random"`, `"1"` to `"4"`, or absent (an older recipe, which keeps its old map). */
export function resolveCount(value: unknown, rand: Rng): RouteCount | null {
  if (value === 'random') return ROUTE_COUNTS[randIntWith(rand, 0, ROUTE_COUNTS.length - 1)]
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return (ROUTE_COUNTS as readonly number[]).includes(n) ? (n as RouteCount) : null
}

/**
 * Both counts together. A recipe that states neither gets null and its maps stay exactly as they were. One stated
 * without the other still makes sense: exits alone means every path is a way out, pathways alone means one way out.
 */
export function resolveWays(options: Readonly<Record<string, unknown>> | undefined, rand: Rng): Ways | null {
  const exits = resolveCount(options?.exits, rand)
  const pathways = resolveCount(options?.pathways, rand)
  if (exits === null && pathways === null) return null
  return { exits: exits ?? 1, pathways: pathways ?? exits ?? 1 }
}

/** A gate on `side`, somewhere in the middle stretch of that edge so a path never hugs a corner. */
function gateOn(side: Side, cols: number, rows: number, width: number, rand: Rng): Gate {
  const along = side === 'south' || side === 'north' ? cols : rows
  const at = randIntWith(rand, Math.floor(along * 0.3), Math.ceil(along * 0.7) - 1)
  const half = Math.floor(width / 2)
  const cells: RouteCell[] = []
  for (let k = -half; k < width - half; k++) cells.push(edgeCell(side, at + k, cols, rows))
  return { side, cells, inside: stepIn(side, edgeCell(side, at, cols, rows)) }
}

function edgeCell(side: Side, at: number, cols: number, rows: number): RouteCell {
  if (side === 'south') return { col: at, row: rows - 1 }
  if (side === 'north') return { col: at, row: 0 }
  if (side === 'west') return { col: 0, row: at }
  return { col: cols - 1, row: at }
}

function stepIn(side: Side, cell: RouteCell): RouteCell {
  if (side === 'south') return { col: cell.col, row: cell.row - 1 }
  if (side === 'north') return { col: cell.col, row: cell.row + 1 }
  if (side === 'west') return { col: cell.col + 1, row: cell.row }
  return { col: cell.col - 1, row: cell.row }
}

/** How far from the border a pathway may stop. Any closer and it reads as another way out. */
export const DEAD_END_MARGIN = 4

/**
 * Plan the network: a gate per exit, a path from each gate to the hub, and a branch out to a stop for every pathway
 * the exits do not already account for.
 */
export function planRoutes(cols: number, rows: number, ways: Ways, rand: Rng, width = 3): RoutePlan {
  const cells = new Set<string>()
  const spine = new Set<string>()
  const hub = {
    col: clamp(Math.round(cols / 2 + (rand() - 0.5) * cols * 0.3), 2, cols - 3),
    row: clamp(Math.round(rows / 2 + (rand() - 0.5) * rows * 0.3), 2, rows - 3),
  }
  const gates = GATE_SIDES[ways.exits](rand).map(side => gateOn(side, cols, rows, width, rand))
  const deadEnds: RouteCell[] = []
  for (let i = gates.length; i < ways.pathways; i++) deadEnds.push(deadEndSpot(hub, gates, deadEnds, cols, rows, rand))

  for (const gate of gates) {
    for (const c of gate.cells) cells.add(`${c.col},${c.row}`)
    // The gate's own middle cell and the step inside it are spine: a way out never pinches shut.
    spine.add(`${gate.cells[Math.floor(gate.cells.length / 2)].col},${gate.cells[Math.floor(gate.cells.length / 2)].row}`)
    spine.add(`${gate.inside.col},${gate.inside.row}`)
    run(gate.inside, hub, width, cols, rows, rand, cells, spine)
  }
  for (const stop of deadEnds) run(hub, stop, width, cols, rows, rand, cells, spine)
  return { entrance: gates[0], gates, deadEnds, hub, cells, spine }
}

/** One winding path from `a` to `b`: waypoints pushed off the straight line, joined by right-angle legs. */
function run(a: RouteCell, b: RouteCell, width: number, cols: number, rows: number, rand: Rng, cells: Set<string>, spine: Set<string>): void {
  const points = [a, ...waypoints(a, b, cols, rows, rand), b]
  for (let i = 1; i < points.length; i++) leg(points[i - 1], points[i], width, cols, rows, rand, cells, spine)
}

const dist = (a: RouteCell, b: RouteCell): number => Math.hypot(a.col - b.col, a.row - b.row)

/**
 * Somewhere for a pathway to stop: a good way off the hub, away from the gates and from the other stops, and never
 * near the border, so a dead end never looks like a way out that failed to open.
 */
function deadEndSpot(hub: RouteCell, gates: readonly Gate[], taken: readonly RouteCell[], cols: number, rows: number, rand: Rng): RouteCell {
  const away = Math.min(cols, rows) / 4
  const avoid = [...gates.map(g => g.inside), ...taken]
  let best: RouteCell | null = null
  let bestScore = -1
  for (let tries = 0; tries < 30; tries++) {
    const cand = {
      col: randIntWith(rand, DEAD_END_MARGIN, cols - 1 - DEAD_END_MARGIN),
      row: randIntWith(rand, DEAD_END_MARGIN, rows - 1 - DEAD_END_MARGIN),
    }
    if (dist(cand, hub) < away) continue
    const score = dist(cand, hub) + Math.min(...avoid.map(p => dist(cand, p)))
    if (score > bestScore) { bestScore = score; best = cand }
  }
  // A map too small for any candidate to sit clear of the hub: step off it as far as the margins allow.
  return best ?? {
    col: clamp(hub.col + Math.round(away), DEAD_END_MARGIN, cols - 1 - DEAD_END_MARGIN),
    row: clamp(hub.row + Math.round(away), DEAD_END_MARGIN, rows - 1 - DEAD_END_MARGIN),
  }
}

/** Two points between `a` and `b`, pushed sideways off the line between them. */
function waypoints(a: RouteCell, b: RouteCell, cols: number, rows: number, rand: Rng): RouteCell[] {
  const out: RouteCell[] = []
  const len = Math.hypot(b.col - a.col, b.row - a.row) || 1
  // unit normal to the a to b line; the push is up to a sixth of the map across it
  const nc = -(b.row - a.row) / len
  const nr = (b.col - a.col) / len
  for (const t of [1 / 3, 2 / 3]) {
    const push = (rand() - 0.5) * 2 * Math.min(cols, rows) / 6
    out.push({
      col: clamp(Math.round(a.col + (b.col - a.col) * t + nc * push), 2, cols - 3),
      row: clamp(Math.round(a.row + (b.row - a.row) * t + nr * push), 2, rows - 3),
    })
  }
  return out
}

/** A right-angle leg from `a` to `b`, `width` cells wide and centred on its line, columns or rows first at random. */
function leg(a: RouteCell, b: RouteCell, width: number, cols: number, rows: number, rand: Rng, cells: Set<string>, spine: Set<string>): void {
  const half = Math.floor(width / 2)
  const paint = (col: number, row: number) => {
    // the centre cell is the SPINE: whatever a layout does with the width, this line stays open
    if (col >= 0 && row >= 0 && col < cols && row < rows) spine.add(`${col},${row}`)
    for (let dr = -half; dr < width - half; dr++) {
      for (let dc = -half; dc < width - half; dc++) {
        const c = col + dc
        const r = row + dr
        if (c >= 0 && r >= 0 && c < cols && r < rows) cells.add(`${c},${r}`)
      }
    }
  }
  let { col, row } = a
  paint(col, row)
  const walkCols = () => { while (col !== b.col) { col += Math.sign(b.col - col); paint(col, row) } }
  const walkRows = () => { while (row !== b.row) { row += Math.sign(b.row - row); paint(col, row) } }
  if (rand() < 0.5) { walkCols(); walkRows() } else { walkRows(); walkCols() }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
