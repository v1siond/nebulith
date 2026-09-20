/**
 * PATHS FIRST: a map's route network, planned before anything is planted.
 *
 * with Zelda, Pokemon and Chrono Trigger as the reference.
 *
 * TWO numbers say what a map is, and the backend serves both. EXITS is how many gates it has on its border, the
 * places a connector hands you to another map, and the first of them is the entrance: is one exit. PATHWAYS is how
  * many paths run inside it. A pathway past the last exit has
 * nowhere to go, so it stops in the map, which is the cave: is one way
 * back out and two branches that end at a room, and is the end of the cave. Those stops
 * are where a closed section, or one that opens when you do something, belongs.
 *
 * This only DECIDES cells. The layouts pave them and grow the place around them.
 */
import type { Rng } from '@/lib/math'
import { randIntWith } from '@/lib/math'

export interface RouteCell { col: number; row: number }
export type Side = 'south' | 'north' | 'west' | 'east'

/** How many exits, or how many pathways. The counts the backend offers. */
/** How many exits, or how many pathways. A NUMBER, not a union of four: *"pathways in towns has higher ceiling
 *  (not limited to 4, we should determine the limit from the grid size"*. A town is a street grid and a street
 *  grid has as many streets as it has room for, so the ceiling is measured off the map rather than fixed here.
 *  EXITS keep their cap: *"exits are maintained as they're now"*. */
export type RouteCount = number
/** What the RANDOM roll picks between when nothing is stated. */
export const ROUTE_COUNTS: readonly RouteCount[] = [1, 2, 3, 4]

/**
 * How many pathways a map this size can actually hold.
 *
 * A pathway is a stretch `width` cells across, and two of them running side by side need a gap you can build
 * something in, or they are one wide road. So each one costs about twice its own width, and the map fits as
 * many as its SHORTER side has room for: a 40x40 at width 3 holds 6, a 70x70 holds 11.
 *
 * This is why the count is not a fixed four. A forest never noticed because it asks for one or two trails; a
 * town is a street grid and wants as many as it can carry.
 */
export function pathwayCeiling(cols: number, rows: number, width = 3): number {
  return Math.max(1, Math.floor(Math.min(cols, rows) / Math.max(2, width * 2)))
}

/** What the two served options come to for one map. */
export interface Pathways { exits: RouteCount; pathways: RouteCount }

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
 * The rule:
 *
 * The planner used to make ONE PATH PER GATE radiating from a hub, so the cross came out as four pathways
 * instead of two. A stretch is now the unit: a THROUGH road leaves the map on both of its ends (2 exits, on
 * opposite sides), and a SPUR leaves on one end and stops inside (1 exit, at its start).
 *
 * The arithmetic falls straight out of that. For P pathways and E exits, every pathway spends 1 or 2 exits,
 * so `P <= E <= 2P`, and given both: `E - P` of them are through roads and `2P - E` are spurs.
 */
const AXES: ReadonlyArray<readonly [Side, Side]> = [['south', 'north'], ['west', 'east']]

/** The share of an edge a gate may sit in, middle only, so a way out never hugs a corner. */
const GATE_SPAN = [0.3, 0.7] as const

/**
 * How many ways out the four edges of a map this size can actually carry.
 *
 * This was the constant 4, one gate per side, and it is why picking six pathways still gave you four exits:
 * the option moved and the map did not. A gate is `width` cells across and sits in the middle stretch of its
 * edge, so what an edge can carry is that stretch divided by a gate plus the gap that keeps two of them from
 * reading as one wide mouth. Four edges, two of each length.
 *
 * Measured, not decreed, which is the same rule `pathwayCeiling` already follows.
 */
export function exitCeiling(cols: number, rows: number, width = 3): number {
  return 2 * gatesPerEdge(cols, width) + 2 * gatesPerEdge(rows, width)
}

/**
 * How many gates fit along ONE edge, measured off the SAME span `gateOn` places them in.
 *
 * Both read `gateSpan`, deliberately: the first cut worked the length out again here as
 * `along * (0.7 - 0.3)`, and in floating point that is `0.39999999999999997`, so a 40-cell edge measured 15.9
 * cells of room and reported one gate fewer than the placer would actually fit. A ceiling and a placer that
 * disagree by one is a map that cannot build what the panel offered.
 */
function gatesPerEdge(along: number, width: number): number {
  const { lo, hi } = gateSpan(along)
  return Math.max(1, Math.floor((hi - lo) / Math.max(2, width + 1)))
}

/** The stretch of an edge a gate may sit in: the middle of it, never a corner. */
function gateSpan(along: number): { lo: number; hi: number } {
  return { lo: Math.floor(along * GATE_SPAN[0]), hi: Math.ceil(along * GATE_SPAN[1]) - 1 }
}

/**
 * How the stretches divide up. Three shapes, and every pathway is exactly one of them:
 *
 *   · THROUGH  two exits, on opposite sides. It crosses the map and stops nowhere.
 *   · SPUR     one exit at its start, and it stops inside.
 *   · BRANCH   no exit of its own. It leaves the network and stops inside.
 *
 * The first two are the requirement. The third is the case the requirement does not reach and the code already
 * had: a CAVE with one mouth and two dead-end galleries (`planRoutes(1 exit, 3 pathways)`), which has more
 * stretches than it has pathways out. Rather than clamp that away, more exits than pathways builds through
 * roads and fewer builds branches, so both the map and the cave come out of one rule.
 */
export function splitPathways(pathways: Pathways): { through: number; spurs: number; branches: number } {
  // TOTAL FOR ANY PAIR, including the ones the rule says cannot exist. `resolvePathways` keeps a served map
  // inside `E <= 2P`, but `planRoutes` is called directly with hand-built counts (the cave, and the whole
  // test matrix), and a combination like 4 exits on 1 pathway has to come out as SOMETHING rather than
  // index past the end of the gate list. Capped by the pathways available and by the two opposite-side
  // axes a map actually has; the remaining exits become spurs.
  const through = Math.min(Math.max(0, pathways.exits - pathways.pathways), pathways.pathways, AXES.length)
  const gatedOnce = pathways.exits - through * 2 // the stretches left holding exactly one gate
  return { through, spurs: Math.max(0, gatedOnce), branches: Math.max(0, pathways.pathways - through - gatedOnce) }
}

/**
 * A count as served: `"random"`, a number, or absent (an older recipe, which keeps its old map).
 *
 * `ceiling` is what RANDOM may roll up to. *"pathways in towns has higher ceiling (not limited to 4, we should
 * determine the limit from the grid size"*, so "random" means the generator decides and the generator decides
 * by the map: a city with room for nine streets may roll nine. Left off it rolls the four a forest trail was
 * written for, which is what `exits` keeps: *"exits are maintained as they're now"*.
 */
export function resolveCount(value: unknown, rand: Rng, ceiling = ROUTE_COUNTS.length): RouteCount | null {
  // One rand() call either way, and 1..4 IS `ROUTE_COUNTS`, so every map that rolled before rolls the same.
  // An unmeasured ceiling (no grid handed in) falls back to that four rather than rolling toward infinity.
  const top = Number.isFinite(ceiling) ? Math.max(1, Math.floor(ceiling)) : ROUTE_COUNTS.length
  if (value === 'random') return randIntWith(rand, 1, top)
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  // ANY whole count the backend cares to offer, not just the four this file used to name. A served option is
  // the backend saying what you may pick; repeating that list here made it two lists to keep in step, and it
  // is what capped a town's streets at four.
  return Number.isInteger(n) && n >= 1 ? (n as RouteCount) : null
}

/**
 * Both counts together. A recipe that states neither gets null and its maps stay exactly as they were. One stated
 * without the other still makes sense: exits alone means every path is a way out, pathways alone means one way out.
 */
export function resolvePathways(
  options: Readonly<Record<string, unknown>> | undefined,
  rand: Rng,
  grid?: { cols: number; rows: number; width?: number },
  /** What this particular map can hold, when the caller knows better than the general rule. A settlement does:
   *  its streets are bounded by the BLOCKS between them, which `streetRoom` measures, not by the path width. */
  stated?: number,
): Pathways | null {
  // …and the pathways are held to what the map can actually carry. Asking a 30x24 town for 8 streets is asking
  // for streets with nothing between them; the ceiling is measured, not decreed. It bounds the RANDOM roll as
  // well as the stated one, so a city still rolls a city's worth of streets.
  const ceiling = stated ?? (grid ? pathwayCeiling(grid.cols, grid.rows, grid.width) : Number.POSITIVE_INFINITY)
  const exits = resolveCount(options?.exits, rand)
  const pathways = resolveCount(options?.pathways, rand, ceiling)
  if (exits === null && pathways === null) return null

  // WHAT THE EDGES CAN CARRY, measured off this map rather than fixed at one gate a side.
  const edges = grid ? exitCeiling(grid.cols, grid.rows, grid.width) : ROUTE_COUNTS.length
  // EXITS ARE INFERRED FROM PATHWAYS when nobody states them. A stretch of road crosses
  // the map unless something stops it, so the inference is two exits each, which is exactly the cross: two
  // pathways, four exits.
  const wanted = exits ?? Math.min(pathways! * 2, edges)
  // …and pathways from exits, the same rule read backwards: two exits can be one road straight through.
  const stretches = pathways ?? Math.max(1, Math.ceil(wanted / 2))
  // At most two exits per pathway, and never more than the edges can hold. FEWER exits than pathways is
  // allowed on purpose: that is the cave, where the extra stretches are galleries that stop rather than
  // pathways out.
  const bounded = clamp(wanted, 1, Math.min(stretches * 2, edges))
  const held = clamp(stretches, 1, ceiling)
  return { exits: bounded as RouteCount, pathways: held as RouteCount }
}

/**
 * A gate on `side`, in the middle stretch of that edge so a path never hugs a corner.
 *
 * `slot` of `of` shares that stretch out when a side carries more than one way out: each gate gets its own
 * slice and rolls a position inside it, so two mouths on one edge cannot overlap into one wide one. `of` is
 * 1 for every map that only ever had one gate a side, and the arithmetic then comes out at the whole stretch,
 * which is exactly what it rolled before.
 */
function gateOn(side: Side, cols: number, rows: number, width: number, rand: Rng, slot = 0, of = 1): Gate {
  const along = side === 'south' || side === 'north' ? cols : rows
  const { lo, hi } = gateSpan(along)
  const slice = Math.max(0, hi - lo) / Math.max(1, of)
  const from = Math.round(lo + slice * slot)
  const to = of === 1 ? hi : Math.max(from, Math.round(lo + slice * (slot + 1)) - 1)
  const at = randIntWith(rand, from, Math.max(from, to))
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
export function planRoutes(cols: number, rows: number, pathways: Pathways, rand: Rng, width = 3): RoutePlan {
  const cells = new Set<string>()
  const spine = new Set<string>()
  const hub = {
    col: clamp(Math.round(cols / 2 + (rand() - 0.5) * cols * 0.3), 2, cols - 3),
    row: clamp(Math.round(rows / 2 + (rand() - 0.5) * rows * 0.3), 2, rows - 3),
  }

  const { through, spurs, branches } = splitPathways(pathways)
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
  // …then the spurs, spread over whatever sides are still free. A side is reused only once every free side
  // has one, and the gates that share a side are placed in their own slices of it rather than on top of each
  // other, which is what lets a map have more ways out than it has edges.
  const rest = AXES.flat().filter(side => side !== 'south' && !taken.has(side))
  const free = taken.has('south') ? shuffled(rest, rand) : ['south' as Side, ...shuffled(rest, rand)]
  const deadEnds: RouteCell[] = []
  const perSide = new Map<Side, number>()
  const sideOf: Side[] = []
  for (let i = 0; i < spurs; i++) {
    const side = free[i % Math.max(1, free.length)]
    sideOf.push(side)
    perSide.set(side, (perSide.get(side) ?? 0) + 1)
  }
  const placed = new Map<Side, number>()
  for (const side of sideOf) {
    const slot = placed.get(side) ?? 0
    placed.set(side, slot + 1)
    gates.push(gateOn(side, cols, rows, width, rand, slot, perSide.get(side) ?? 1))
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
  sealTheBorder(cells, gates, cols, rows)
  return { entrance: gates[0], gates, deadEnds, hub, cells, spine }
}

/**
 * THE BORDER OPENS AT THE GATES AND NOWHERE ELSE, said by the layer that cuts the ways.
 *
 * `leg` paints a `width × width` SQUARE around each point it walks through, which is what gives a corridor its
 * width. A leg that runs ALONG the line one cell inside the border therefore paints the border line too, for
 * its whole length: measured on a meadow, a 3-cell south gate published FIVE cells of route on the border row,
 * and the two extra ones were paved, planted on by the treeline, and left looking like part of the way out.
 * That is the `[tree][ ][ ][ ][tree]` opening, and it starts here rather than in any of the painters.
 *
 * `sealMapEdge` already says this rule for the objects layer ("the route network is spared, but on the ring
 * only the gates"). It belongs in the plan as well, because a border cell nobody may walk out of is not part
 * of a way. PATHWAYS.md §4.
 */
function sealTheBorder(cells: Set<string>, gates: readonly Gate[], cols: number, rows: number): void {
  const mouths = new Set(gates.flatMap(gate => gate.cells.map(c => `${c.col},${c.row}`)))
  for (const key of [...cells]) {
    if (mouths.has(key)) continue
    const [col, row] = key.split(',').map(Number)
    if (col === 0 || row === 0 || col === cols - 1 || row === rows - 1) cells.delete(key)
  }
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
