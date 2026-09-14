/**
 * PATHS FIRST: a map's route network, planned before anything is planted.
 *
 * with Zelda, Pokemon and Chrono Trigger as the reference.
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

/**
 * A PATHWAY IS A STRETCH OF ROAD, and this is the definition the whole planner is built on.
 *
 * and then the rule:
 *
 * *"a pathway is a stretch of road that has 1 or 2 exit / either on oposites sides of it, if 2, or at the start of it
 * if it's 1"*
 *
 * The planner used to make ONE PATH PER GATE radiating from a hub, so his cross came out as four pathways instead of
 * two. A stretch is now the unit: a THROUGH road leaves the map on both of its ends (2 exits, on opposite sides), and
 * a SPUR leaves on one end and stops inside (1 exit, at its start).
 *
 * The arithmetic falls straight out of that. For P pathways and E exits, every pathway spends 1 or 2 exits, so `P <=
 * E <= 2P`, and given both: `E - P` of them are through roads and `2P - E` are spurs.
 */
const AXES: ReadonlyArray<readonly [Side, Side]> = [['south', 'north'], ['west', 'east']]

/** One gate per side, so four is every side of the map and the ceiling on exits. */
export const MAX_EXITS = 4

/**
 * How the stretches divide up. Three shapes, and every pathway is exactly one of them:
 *
 *   · THROUGH  two exits, on opposite sides. It crosses the map and stops nowhere.
 *   · SPUR     one exit at its start, and it stops inside.
 *   · BRANCH   no exit of its own. It leaves the network and stops inside.
 *
 * The first two are his sentence. The third is the case his sentence does not reach and the code already
 * had: a CAVE with one mouth and two dead-end galleries (`planRoutes(1 exit, 3 pathways)`), which has more
 * stretches than it has ways out. Rather than clamp that away, more exits than pathways builds through
 * roads and fewer builds branches, so both his map and his cave come out of one rule.
 */
export function splitPathways(ways: Ways): { through: number; spurs: number; branches: number } {
  // TOTAL FOR ANY PAIR, including the ones his rule says cannot exist. `resolveWays` keeps a served map
  // inside `E <= 2P`, but `planRoutes` is called directly with hand-built counts (the cave, and the whole
  // test matrix), and a combination like 4 exits on 1 pathway has to come out as SOMETHING rather than
  // index past the end of the gate list. Capped by the pathways available and by the two opposite-side
  // axes a map actually has; the remaining exits become spurs.
  const through = Math.min(Math.max(0, ways.exits - ways.pathways), ways.pathways, AXES.length)
  const gatedOnce = ways.exits - through * 2 // the stretches left holding exactly one gate
  return { through, spurs: Math.max(0, gatedOnce), branches: Math.max(0, ways.pathways - through - gatedOnce) }
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

  // EXITS ARE INFERRED FROM PATHWAYS when nobody states them. A stretch of road crosses the map unless something
  // stops it, so the inference is two exits each, which is exactly his cross: two pathways, four exits. Capped at one
  // gate per side.
  const wanted = exits ?? Math.min(pathways! * 2, MAX_EXITS)
  // …and pathways from exits, the same rule read backwards: two exits can be one road straight through.
  const stretches = pathways ?? Math.max(1, Math.ceil(wanted / 2))
  // At most two exits per pathway, and at most one gate per side. FEWER exits than pathways is allowed on
  // purpose: that is the cave, where the extra stretches are galleries that stop rather than ways out.
  const bounded = clamp(wanted, 1, Math.min(stretches * 2, MAX_EXITS))
  return { exits: bounded as RouteCount, pathways: stretches as RouteCount }
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
 * Plan the network as STRETCHES, not spokes.
 *
 * `splitPathways` says how many cross the map and how many stop inside. A through road takes an opposite PAIR
 * of sides, which is what makes two of them read as a cross rather than as four separate roads; a spur takes
 * one remaining side and ends at a stop. Every stretch is routed via the hub, so the network stays one
 * connected thing, which is the guarantee the layouts depend on.
 */
export function planRoutes(cols: number, rows: number, ways: Ways, rand: Rng, width = 3): RoutePlan {
  const cells = new Set<string>()
  const spine = new Set<string>()
  const hub = {
    col: clamp(Math.round(cols / 2 + (rand() - 0.5) * cols * 0.3), 2, cols - 3),
    row: clamp(Math.round(rows / 2 + (rand() - 0.5) * rows * 0.3), 2, rows - 3),
  }

  const { through, spurs, branches } = splitPathways(ways)
  // THE WAY IN IS ALWAYS THE NEAR EDGE. `entrance` is `gates[0]` and every layout leans on it being south,
  // so the south/north axis is laid first and south before north. Shuffling the axes broke that on the first
  // run. What varies is which SIDES the spurs take, not where you come in.
  const axes = AXES
  const gates: Gate[] = []
  const taken = new Set<Side>()

  // THE THROUGH ROADS FIRST: each is one stretch from an edge to the opposite edge, past the hub.
  for (let i = 0; i < through && i < axes.length; i++) {
    const [a, b] = axes[i]
    taken.add(a)
    taken.add(b)
    gates.push(gateOn(a, cols, rows, width, rand), gateOn(b, cols, rows, width, rand))
  }
  // …then the spurs, on whatever sides are still free, so two mouths never fight over one edge.
  const rest = AXES.flat().filter(side => side !== 'south' && !taken.has(side))
  const free = taken.has('south') ? shuffled(rest, rand) : ['south' as Side, ...shuffled(rest, rand)]
  const deadEnds: RouteCell[] = []
  for (let i = 0; i < spurs; i++) {
    const side = free[i % Math.max(1, free.length)]
    gates.push(gateOn(side, cols, rows, width, rand))
  }

  const open = (gate: Gate): void => {
    for (const c of gate.cells) cells.add(`${c.col},${c.row}`)
    // The gate's own middle cell and the step inside it are spine: a way out never pinches shut.
    const mid = gate.cells[Math.floor(gate.cells.length / 2)]
    spine.add(`${mid.col},${mid.row}`)
    spine.add(`${gate.inside.col},${gate.inside.row}`)
  }

  for (let i = 0; i < through; i++) {
    const [entry, exit] = [gates[i * 2], gates[i * 2 + 1]]
    open(entry)
    open(exit)
    run(entry.inside, hub, width, cols, rows, rand, cells, spine)
    run(hub, exit.inside, width, cols, rows, rand, cells, spine)
  }
  for (let i = 0; i < spurs; i++) {
    const gate = gates[through * 2 + i]
    open(gate)
    // A SPUR'S ONE EXIT IS AT ITS START. It runs in to the hub, where it meets the rest of the network; a
    // stretch that ends among the other roads has arrived somewhere and needs no stop of its own.
    run(gate.inside, hub, width, cols, rows, rand, cells, spine)
  }
  // A BRANCH has no way out: it leaves the hub and stops, which is what makes a cave gallery a gallery.
  for (let i = 0; i < branches; i++) {
    const stop = deadEndSpot(hub, gates, deadEnds, cols, rows, rand)
    deadEnds.push(stop)
    run(hub, stop, width, cols, rows, rand, cells, spine)
  }
  return { entrance: gates[0], gates, deadEnds, hub, cells, spine }
}

/** A copy in random order. Which axis a road takes should vary between maps, nothing more. */
function shuffled<T>(items: readonly T[], rand: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randIntWith(rand, 0, i)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
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
