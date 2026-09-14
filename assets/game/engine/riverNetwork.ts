/**
 * THE RIVER, AS ITS OWN SUBSYSTEM.
 *
 * Alexander, 2026-09-13, having guessed the state of it before looking: *"do we have a separate module to
 * build the river layouts? like the channel, the current, etc and then insert it based of generator usage? I
 * bet we don't, I bet we have a fucking spagetti code where everythign is just a huge shitstorm of methods
 * instead of separate modules handling each individual subsystem."*
 *
 * He was right. Measured at the time: `stageGenerator.ts` was 5,775 lines and 211 functions, 56 of them about
 * water, all in that one file with the trees and the buildings and the settlements. `pathNetwork.ts` already
 * existed, so the project knew the pattern and water had simply never been given it, which is also why a fix
 * to the woodland's river never reached the jungle's.
 *
 * This is the first piece pulled out: THE CURRENT. It is the most self-contained (pure graph work over a set
 * of wet cells and the map's bounds, touching no ground, no props and no palette) and the one he has raised
 * most often, so it is the honest place to start rather than a big-bang move.
 *
 * The seam is deliberately narrow: a river needs to know how big the map is, nothing else. `RiverBounds` is
 * that, and `ArchetypeContext` satisfies it structurally, so the caller passes itself and no adapter exists.
 */

/** All a river needs to know about the map it runs through. */
export interface RiverBounds {
  cols: number
  rows: number
}

/** A `col,row` key back into its pair. The module's own, so it does not import from the file it left. */
const toCell = (key: string): { col: number; row: number } => {
  const [col, row] = key.split(',').map(Number)
  return { col, row }
}

/**
 * WHICH WAY THE WATER IS GOING, per cell.
 *
 * Alexander, 2026-09-13, with three drawings: *"ALL FUCKING TILES USED ARE RANDOMLY ALIGNED, NONE IS THE SAME
 * PATTERN, THE SAME DIRECTION … MOST OF THEM ARE BACKWARDS TOO, LIKE NONE OF THEM ARE TAKING INTO
 * CONSIDERATION THE DIRECTION OF THE RIVER AROUND THE FUCKING MAP"*, and then the target, drawn:
 *
 *     what he sees        what he wants            or
 *     | - | - |-          -------                  | | |
 *                         ------                   | | |
 *                         ------                   | | |
 *
 * WHY IT CAME OUT SCRAMBLED. The first version walked the wet cells as a graph and gave each cell the step
 * that REACHED it. That is right for a channel one cell wide and wrong for every real river, because a river
 * is WIDE: the walk wanders across the channel as happily as along it, so two cells in the same cross-section
 * get perpendicular headings. His `| - | - |-` is exactly a depth-first walk of a three-wide band.
 *
 * A cell's heading is two independent facts, and they need two different answers:
 *
 *   1. THE AXIS — does this stretch run along col or along row? That is a fact about the channel's SHAPE, so
 *      measure the shape: how far the water reaches through this cell each way. A three-wide horizontal band
 *      reaches ~40 along col and 3 along row at every one of its cells, so the whole band answers "col",
 *      cross-section included. This is what makes his `-------` come out level.
 *
 *   2. THE SIGN — of the two ways along that axis, which is downstream? That is a fact about the channel as a
 *      WHOLE, so it comes from a distance field, not from a neighbour. BFS from an EXTREMITY of the reach
 *      makes the distance climb monotonically from one end to the other, so "downstream = the neighbour that
 *      is farther" agrees everywhere. The extremity is found with the standard double sweep (BFS from any
 *      cell, take the farthest; BFS again from that one), which lands on a true end of the reach rather than
 *      the middle. Seeding in the middle would give a spring flowing out both ways.
 *
 * A RING IS THE ONE CASE A DISTANCE FIELD CANNOT ANSWER, and it is the case he drew (image #9, a river going
 * around the map). Distance from any seed on a ring climbs BOTH ways and the two halves collide at the far
 * side. A ring does not have an upstream, it CIRCULATES, so it gets the other rule: turn the vector from the
 * ring's middle to the cell by ninety degrees and follow that around. Which rule applies is decided exactly,
 * not by a threshold: the water is a ring when it encircles dry land (`encirclesDryLand`).
 *
 * Returns quarter turns: 0 = +col, 1 = +row, 2 = -col, 3 = -row. Every wet cell of a channel gets one.
 */
/** The four orthogonal steps, in HEADING order: index 0 is +col, 1 is +row, 2 is -col, 3 is -row, which is
 *  what makes a heading and a step the same number. Exported because it is the river's vocabulary and its
 *  callers outside this module (the rocks) walk the channel with it. */
export const FLOW_STEPS: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]]
/** How far along one axis to look for the channel's run. A river is a handful of cells across and a map is
 *  tens long, so this only has to see PAST the width to answer, and 12 does on every size we generate. */
const RUN_REACH = 12
/** Axis of a stretch: which of the two grid directions it runs along. */
type FlowAxis = 0 | 1 // 0 = col, 1 = row

const flowKey = (col: number, row: number): string => `${col},${row}`

/** The water cells reachable from `start`, 4-connected. One river arm, one component. */
function waterComponent(water: ReadonlySet<string>, start: string, seen: Set<string>): Set<string> {
  const found = new Set<string>([start])
  const stack = [start]
  seen.add(start)
  while (stack.length > 0) {
    const { col, row } = toCell(stack.pop() as string)
    for (const [dc, dr] of FLOW_STEPS) {
      const k = flowKey(col + dc, row + dr)
      if (!water.has(k) || seen.has(k)) continue
      seen.add(k)
      found.add(k)
      stack.push(k)
    }
  }
  return found
}

/** Every separate body of water, so two arms of the same map are each given their own current. */
function waterComponents(water: ReadonlySet<string>): Set<string>[] {
  const seen = new Set<string>()
  const out: Set<string>[] = []
  for (const key of water) if (!seen.has(key)) out.push(waterComponent(water, key, seen))
  return out
}

/** How many cells of water lie in a straight line through this one, counting both ways along (dc,dr). */
function runThrough(water: ReadonlySet<string>, col: number, row: number, dc: number, dr: number): number {
  let n = 1
  for (let s = 1; s <= RUN_REACH && water.has(flowKey(col + dc * s, row + dr * s)); s++) n++
  for (let s = 1; s <= RUN_REACH && water.has(flowKey(col - dc * s, row - dr * s)); s++) n++
  return n
}

/** WHICH WAY THIS STRETCH RUNS, from the water's own shape: the axis it reaches farther along. Ties go to
 *  col, so a perfectly square pool answers consistently instead of speckling. */
function channelAxis(water: ReadonlySet<string>, key: string): FlowAxis {
  const { col, row } = toCell(key)
  return runThrough(water, col, row, 1, 0) >= runThrough(water, col, row, 0, 1) ? 0 : 1
}

/** Graph distance from `from` to every cell of the component. */
function waterDistances(component: ReadonlySet<string>, from: string): Map<string, number> {
  const dist = new Map<string, number>([[from, 0]])
  let frontier = [from]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const key of frontier) {
      const { col, row } = toCell(key)
      const d = (dist.get(key) as number) + 1
      for (const [dc, dr] of FLOW_STEPS) {
        const k = flowKey(col + dc, row + dr)
        if (!component.has(k) || dist.has(k)) continue
        dist.set(k, d)
        next.push(k)
      }
    }
    frontier = next
  }
  return dist
}

/** The cell of `dist` that is farthest from its seed. */
function farthestFrom(dist: ReadonlyMap<string, number>): string {
  let best = ''
  let far = -1
  for (const [key, d] of dist) if (d > far) { far = d; best = key }
  return best
}

/** Does this water RING something? True when a dry cell inside its reach cannot be walked out to the map's
 *  edge without crossing water, which is precisely what "the river goes around the map" means. Exact: a
 *  flood of the dry cells inward from the border, no threshold and no guessing at shapes. */
function encirclesDryLand(component: ReadonlySet<string>, cols: number, rows: number): boolean {
  const outside = new Set<string>()
  const stack: string[] = []
  const consider = (col: number, row: number): void => {
    if (col < 0 || row < 0 || col >= cols || row >= rows) return
    const k = flowKey(col, row)
    if (component.has(k) || outside.has(k)) return
    outside.add(k)
    stack.push(k)
  }
  for (let col = 0; col < cols; col++) { consider(col, 0); consider(col, rows - 1) }
  for (let row = 0; row < rows; row++) { consider(0, row); consider(cols - 1, row) }
  while (stack.length > 0) {
    const { col, row } = toCell(stack.pop() as string)
    for (const [dc, dr] of FLOW_STEPS) consider(col + dc, row + dr)
  }
  return outside.size + component.size < cols * rows
}

/** The middle of a body of water, as the average of its cells. */
function waterMiddle(component: ReadonlySet<string>): { col: number; row: number } {
  let col = 0
  let row = 0
  for (const key of component) { const c = toCell(key); col += c.col; row += c.row }
  return { col: col / component.size, row: row / component.size }
}

/** Turn an axis and a direction along it into the heading the renderer reads. */
const headingFor = (axis: FlowAxis, forward: boolean): number => (axis === 0 ? (forward ? 0 : 2) : (forward ? 1 : 3))

/** A REACH: downstream is away from the end the distance field is seeded at, so every cell along it agrees. */
function reachFlow(component: ReadonlySet<string>, into: Map<string, number>, water: ReadonlySet<string>): void {
  const first = component.values().next().value as string
  const end = farthestFrom(waterDistances(component, first)) // the double sweep: a true end, not the middle
  const dist = waterDistances(component, end)
  for (const key of component) {
    const axis = channelAxis(water, key)
    const { col, row } = toCell(key)
    const [dc, dr] = FLOW_STEPS[axis]
    const here = dist.get(key) ?? 0
    const ahead = dist.get(flowKey(col + dc, row + dr))
    const behind = dist.get(flowKey(col - dc, row - dr))
    // Downstream is the way the distance CLIMBS. With only one neighbour on the axis, that one decides; with
    // neither (a one-cell puddle in the reach) the reach's own orientation is all there is, so take forward.
    const forward = ahead !== undefined && behind !== undefined ? ahead > behind
      : ahead !== undefined ? ahead > here
        : behind !== undefined ? behind < here
          : true
    into.set(key, headingFor(axis, forward))
  }
}

/** A RING: it circulates, so downstream is the tangent around its middle. Same turn everywhere, no seam. */
function ringFlow(component: ReadonlySet<string>, into: Map<string, number>, water: ReadonlySet<string>): void {
  const mid = waterMiddle(component)
  for (const key of component) {
    const { col, row } = toCell(key)
    const axis = channelAxis(water, key)
    // Tangent of a clockwise turn about the middle: (dcol, drow) = (-(row - midRow), (col - midCol)).
    const tangent = axis === 0 ? -(row - mid.row) : col - mid.col
    into.set(key, headingFor(axis, tangent >= 0))
  }
}

export function flowField(bounds: RiverBounds, water: ReadonlySet<string>): Map<string, number> {
  const flow = new Map<string, number>()
  for (const component of waterComponents(water)) {
    if (encirclesDryLand(component, bounds.cols, bounds.rows)) ringFlow(component, flow, water)
    else reachFlow(component, flow, water)
  }
  return flow
}

/** The ground labels that ARE water without saying so in the name. */
const WATER_LIKE = new Set(['water', 'ice_water', 'oasis', 'koi'])

/**
 * IS THIS CELL WATER? The one question every pass asks, so it belongs to the river rather than to whichever
 * file happened to need it first. Any label CONTAINING "water" counts, which is what keeps the depth bands
 * (`water_shallow`, `water_deep`) and the puddle film answering the same way as the plain channel.
 */
export const isWaterGround = (g: string | undefined): boolean => !!g && (WATER_LIKE.has(g) || g.includes('water'))

/** How deep each `depth` option cuts, in blocks. Served as a string by the generator catalog. */
const CHANNEL_DEPTH: Readonly<Record<string, number>> = { '1': 1, '2': 2 }

/** What a map asks of its channel, beyond the bounds: how deep to cut and where the bed is recorded. */
export interface RiverCut extends RiverBounds {
  elevation: number[][]
  options: Readonly<Record<string, unknown>> | undefined
}

/** How far below the walking floor this map cuts its channel. 0 when the generator states nothing, which
 *  leaves the river flush and is what every recipe did before the option existed. */
export function channelDepth(cut: RiverCut): number {
  const served = cut.options?.depth
  return typeof served === 'string' ? CHANNEL_DEPTH[served] ?? 0 : 0
}

/**
 * CUT THE CHANNEL: every bed cell drops below the walking floor.
 *
 * RELATIVE to whatever the ground already stands at, so a river crossing a raised region cuts into THAT
 * region rather than snapping to an absolute depth. At level 0 the two are identical, which is every map
 * that states no relief.
 *
 * Collision is NOT touched here. Carving already blocks a water cell, and a second opinion about walkability
 * in a second place is how the ten `=== 'water'` conditionals came to exist.
 */
export function digChannel(cut: RiverCut, water: ReadonlySet<string>): void {
  const depth = channelDepth(cut)
  if (depth === 0) return
  for (const key of water) {
    const { col, row } = toCell(key)
    if (col >= 0 && row >= 0 && col < cut.cols && row < cut.rows) cut.elevation[row][col] -= depth
  }
}
