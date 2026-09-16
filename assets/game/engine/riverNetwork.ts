import { randIntWith, type Rng } from '@/lib/math'
import { cellKey, flood, forEachCell, inBounds, toCell, ORTHO, type Cell } from './grid'
import { type GeneratorCrossing, type GeneratorOptionValue, type GeneratorPalette } from '@/lib/generatorCatalog'
import { type RoutePlan } from '@/engine/pathNetwork'
import { resolveComposition, resolveTile } from '@/engine/tileset/tileset'
import { styleCatalog } from '@/engine/tileset/styleTiles'
import { groundTileColor } from '@/engine/tileset/groundColor'
import { type ZoneId } from '@/engine/zones'

/**
 * THE RIVER, AS ITS OWN SUBSYSTEM.
 *
 * That was right. Measured at the time: `stageGenerator.ts` was 5,775 lines and 211 functions, 56 of them about
 * water, all in that one file with the trees and the buildings and the settlements. `pathNetwork.ts` already
 * existed, so the project knew the pattern and water had simply never been given it, which is also why a fix
 * to the woodland's river never reached the jungle's.
 *
 * This is the first piece pulled out: THE CURRENT. It is the most self-contained (pure graph work over a set
 * of wet cells and the map's bounds, touching no ground, no props and no palette) and the one it has raised
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

export type { Cell } from './grid'

/**
 * WHICH WAY THE WATER IS GOING, per cell.
 *
 * The target, drawn:
 *
 *     what it drew        what it should draw      or
 *     | - | - |-          -------                  | | |
 *                         ------                   | | |
 *                         ------                   | | |
 *
 * WHY IT CAME OUT SCRAMBLED. The first version walked the wet cells as a graph and gave each cell the step
 * that REACHED it. That is right for a channel one cell wide and wrong for every real river, because a river
 * is WIDE: the walk wanders across the channel as happily as along it, so two cells in the same cross-section
 * get perpendicular headings. The `| - | - |-` is exactly a depth-first walk of a three-wide band.
 *
 * A cell's heading is two independent facts, and they need two different answers:
 *
 *   1. THE AXIS — does this stretch run along col or along row? That is a fact about the channel's SHAPE, so
 *      measure the shape: how far the water reaches through this cell each way. A three-wide horizontal band
 *      reaches ~40 along col and 3 along row at every one of its cells, so the whole band answers "col",
 *      cross-section included. This is what makes the `-------` come out level.
 *
 *   2. THE SIGN — of the two pathways along that axis, which is downstream? That is a fact about the channel as a
 *      WHOLE, so it comes from a distance field, not from a neighbour. BFS from an EXTREMITY of the reach
 *      makes the distance climb monotonically from one end to the other, so "downstream = the neighbour that
 *      is farther" agrees everywhere. The extremity is found with the standard double sweep (BFS from any
 *      cell, take the farthest; BFS again from that one), which lands on a true end of the reach rather than
 *      the middle. Seeding in the middle would give a spring flowing out both pathways.
 *
 * A RING IS THE ONE CASE A DISTANCE FIELD CANNOT ANSWER, and it is the case it drew (image #9, a river going
 * around the map). Distance from any seed on a ring climbs BOTH pathways and the two halves collide at the far
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

/** How many cells of water lie in a straight line through this one, counting both pathways along (dc,dr). */
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
/** How far around a cell the axis vote looks. Two cells each way is wider than any river we carve is thick,
 *  so the vote is always taken over a piece of the STRETCH rather than over one cross-section. */
const AXIS_VOTE = 2

/**
 * THE AXIS, AGREED WITH THE WATER AROUND IT.
 *
 * 2026-09-13:
 *
 * `channelAxis` measures ONE cell, and a one-cell measurement disagrees with its neighbours exactly where a
 * river bends or widens, because the reach along the two axes is nearly equal there and a single cell can tip
 * the other way. It then draws its current straight across the stream. Measured on a woodland: 6 cells of 130,
 * 5%, every one of them at a bend.
 *
 * A river does not change direction one cell at a time, so the axis is settled by a VOTE over the cell and the
 * water around it. One pass is enough by construction: an outlier is outnumbered by the stretch it sits in,
 * and a genuine turn is a majority of its own within two cells. Ties keep the cell's own answer, so a square
 * pool still answers consistently instead of speckling.
 */
function agreedAxes(component: ReadonlySet<string>, water: ReadonlySet<string>): Map<string, FlowAxis> {
  const raw = new Map<string, FlowAxis>()
  for (const key of component) raw.set(key, channelAxis(water, key))
  const agreed = new Map<string, FlowAxis>()
  for (const key of component) {
    const { col, row } = toCell(key)
    let alongCol = 0
    let alongRow = 0
    for (let dc = -AXIS_VOTE; dc <= AXIS_VOTE; dc++) {
      for (let dr = -AXIS_VOTE; dr <= AXIS_VOTE; dr++) {
        const axis = raw.get(flowKey(col + dc, row + dr))
        if (axis === undefined) continue
        if (axis === 0) alongCol++
        if (axis === 1) alongRow++
      }
    }
    const own = raw.get(key) as FlowAxis
    if (alongCol === alongRow) { agreed.set(key, own); continue }
    // THE VOTE IS A PREFERENCE, NOT AN OVERRIDE. A cell at the tip of a bend can be outvoted onto an axis it
    // has no water on at all, and then its current points straight into the bank, which is the very thing this
    // is here to stop. Where the stretch disagrees with the cell's own shape, the shape wins.
    const voted: FlowAxis = alongCol > alongRow ? 0 : 1
    agreed.set(key, hasWaterAlong(water, key, voted) ? voted : own)
  }
  return agreed
}

/** Is there water either way along this axis from this cell? A heading is only honest if there is. */
function hasWaterAlong(water: ReadonlySet<string>, key: string, axis: FlowAxis): boolean {
  const { col, row } = toCell(key)
  const [dc, dr] = FLOW_STEPS[axis]
  return water.has(flowKey(col + dc, row + dr)) || water.has(flowKey(col - dc, row - dr))
}

function reachFlow(component: ReadonlySet<string>, into: Map<string, number>, water: ReadonlySet<string>): void {
  const first = component.values().next().value as string
  const end = farthestFrom(waterDistances(component, first)) // the double sweep: a true end, not the middle
  const dist = waterDistances(component, end)
  const axes = agreedAxes(component, water)
  for (const key of component) {
    const axis = axes.get(key) as FlowAxis
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
  const axes = agreedAxes(component, water)
  for (const key of component) {
    const { col, row } = toCell(key)
    const axis = axes.get(key) as FlowAxis
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
  /** The generator's own served options, the same shape the catalog parses. It was `unknown` here while the
   *  channel was the only reader, but a deck reads them too, so one type across the module or the interfaces
   *  cannot be combined. */
  options: Readonly<Record<string, GeneratorOptionValue>> | undefined
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
    if (inBounds(col, row, cut.cols, cut.rows)) cut.elevation[row][col] -= depth
  }
}

// A band decides the LABEL and whether you can wade it. It used to decide a COLOUR too, which is what put
// three blues in one river; the surface takes one served tone now (see the depth pass).
export interface WaterBand { label: string; walkable: boolean }
export const WATER_BANDS: Readonly<Record<'shallow' | 'open' | 'deep', WaterBand>> = {
  shallow: { label: 'water_shallow', walkable: true },
  open: { label: 'water', walkable: false },
  deep: { label: 'water_deep', walkable: false },
}
/** How far from the bank the water is still shallow. */
const SHALLOW_TO = 1
/** How many cells in from the bank the water turns deep. */
export const DEEP_WATER_FROM = 3

/** The shape of a channel: how wide, how far it wanders, and optionally which way it must run. */
export interface ChannelShape {
  half: number
  /** how far the centreline wanders, as a share of the map's width across it */
  swing: number
  /** force it to run left to right (cutting top from bottom). Absent -> rolled. */
  horizontal?: boolean
}

// ── the channel itself ────────────────────────────────────────────────────
// Where the water GOES, as opposed to which way it flows once it is there. Pulled across whole: a river's
// shape is the same question in a woodland, a jungle and a meadow, and keeping three copies of the answer in
// one 5,500-line file is exactly what let the templates drift apart.

/** What a map needs to hand over to have a channel carved into it. */
export interface RiverCarve extends RiverCut {
  ground: string[][]
  collision: boolean[][]
  floorColors: (string | undefined)[][]
  rand: Rng
}

/** The three courses a river can take across a map. */
export type RiverCourse = 'through' | 'divides' | 'around'
export const RIVER_COURSES: readonly RiverCourse[] = ['through', 'divides', 'around']

/** The pure half of `riverCourse`, exported so "random" can be tested as a DISTRIBUTION rather than guessed
 *  from what a map happens to look like. */
export function resolveRiverCourse(value: GeneratorOptionValue | undefined, legacy: RiverCourse, rand: Rng): RiverCourse | null {
  if (value === undefined || value === false || value === 'none') return null
  if (value === true) return legacy
  if (value === 'random') return RIVER_COURSES[randIntWith(rand, 0, RIVER_COURSES.length - 1)]
  return (RIVER_COURSES as readonly string[]).includes(value) ? (value as RiverCourse) : null
}

/**
 * WHICH BAND a cell of water is, by how far it lies from the bank. Depth only.
 *
 * It used to answer `shallow` for any WADEABLE cell and depth for the rest, which tied the label to the
 * walkability: the moment wading stopped (a cut channel, where the bank stands a block above the water and
 * you would have to climb down a wall to get in) the shallow band vanished from the map entirely. They are
 * two different questions. This one is the label; `wadeableShallows` answers the other.
 */
export function waterBand(depth: number): WaterBand {
  if (depth >= DEEP_WATER_FROM) return WATER_BANDS.deep
  if (depth <= SHALLOW_TO) return WATER_BANDS.shallow
  return WATER_BANDS.open
}


/** A watercourse running edge to edge through the map — the jungle's creek, and the `through` and `divides`
 *  rivers. The draw order is unchanged when nothing is forced, so the jungle's creek is byte-identical. */
// TRIED, MEASURED, AND NOT KEPT: turning the channel to CROSS the planned pathways.
//
// The pathways ARE planned before a drop of water is carved, and the channel ignores them, so a river can
// come out lying along a way for its whole length and every cell of the overlap gets planked. That is the
// The obvious version was to count which axis the pathways mostly step along and run the channel across it. Built
// and measured, seed 5, `divides`, 2 exits and 2 pathways, counting the flat wooden deck cells on the map:
//
//     woodland 53 -> 42    meadow 65 -> 79    jungle 64 -> 82
//
// It helps the one case and makes the other two WORSE, because a two-pathway network already uses both axes:
// turning the river off one way puts it along the other. So the axis is not where this is decided.
//
// What it actually needs is repair rather than prediction: carve the river, then where it has landed ALONG a
// way, move the way off the water, and where it merely meets one, make that a crossing. That is a real piece
// of work on `pathNetwork`, not a line here, so it is written down rather than half-done.

export function carveChannel(ctx: RiverCarve, pal: GeneratorPalette | undefined, shape: ChannelShape): Set<string> {
  const { cols, rows, ground, collision, floorColors } = ctx
  const water = new Set<string>()
  const half = shape.half
  const vertical = shape.horizontal === undefined ? ctx.rand() < 0.5 : !shape.horizontal
  const span = vertical ? rows : cols
  const across = vertical ? cols : rows
  const phase = ctx.rand() * Math.PI * 2
  const phase2 = ctx.rand() * Math.PI * 2
  // The centreline wanders across the map as it runs down it — two sine terms so the meander is irregular
  // rather than a wave, kept off the edges so the creek never degenerates into a border.
  const centre = (along: number): number => {
    const mid = across / 2
    const swing = across * shape.swing
    return mid + swing * Math.sin(along * 0.14 + phase) + swing * 0.4 * Math.sin(along * 0.31 + phase2)
  }
  for (let along = 0; along < span; along++) {
    const c = centre(along)
    for (let off = Math.floor(c - half); off <= Math.ceil(c + half); off++) {
      if (Math.abs(off - c) > half) continue
      const col = vertical ? off : along
      const row = vertical ? along : off
      if (!inBounds(col, row, cols, rows)) continue
      ground[row][col] = 'water'
      collision[row][col] = true
      // FLAT, not noisy. This used to vary the intensity per 3x3 block from a position hash, which is a
      // per-cell colour lottery inside one river:
      // `settleWaterDepth` overwrites channel cells afterwards anyway, so the noise was also wasted work.
      if (pal?.water) floorColors[row][col] = pal.water
      water.add(`${col},${row}`)
    }
  }
  // Every channel-carved course comes through here: `through`, `divides`, and the jungle's creek.
  digChannel(ctx, water)
  return water
}

// ── the bank, and what crosses it ─────────────────────────────────────────
// The shore a river leaves behind, and the decision of what spans it. Both are the river's business: a bank
// is the edge of the water and a crossing is sized by how wide the water turned out to be, so keeping either
// in the layouts is what let three templates answer the same question three pathways.

/**
 * WHERE TO PUT A CROSSING: the line near `want` where the water is NARROWEST.
 *
 * On 2026-09-13 looking at a
 * meadow:
 *
 * A crossing used to be laid at a fixed fraction along the river, and the flat deck under it has to reach both
 * banks, so it is as long as the water is wide THERE. On a river that meanders, a straight slice through the
 * middle can be twice the river's actual width, and the deck comes out a causeway with a small bridge
 * somewhere in it. Roads do not cross rivers at their widest, they cross at the narrows.
 *
 * `widths` is how many wet cells lie on each line. Ties go to the line closest to `want`, so a straight river
 * (where every line is the same) crosses exactly where it always did.
 */
export function narrowestLine(widths: ReadonlyMap<number, number>, want: number, reach: number): number {
  let best = want
  let bestWidth = widths.get(want) ?? Infinity
  for (let d = 1; d <= reach; d++) {
    for (const at of [want - d, want + d]) {
      const width = widths.get(at)
      if (width === undefined || width >= bestWidth) continue
      best = at
      bestWidth = width
    }
  }
  return best
}

/** The shortest bridge that reads as one. Below this it is a plank, not a crossing. */
export const MIN_BRIDGE_SPAN = 3

/** What a map needs to hand over to be asked which crossing it wants. */
export interface RiverCrossings {
  /** ONE crossing per map, cached here the first time a deck is laid, so every bridge on it matches. The
   *  field is mutable on purpose: that memo IS the "picked once" rule. */
  crossing?: GeneratorCrossing | null
  crossings?: Readonly<Record<string, GeneratorCrossing>>
  options: Readonly<Record<string, GeneratorOptionValue>> | undefined
  rand: Rng
}



/** How many consecutive water cells lie beyond `at` in direction (dc, dr) — how far the river reaches that way. */
export function waterReach(water: Set<string>, at: Cell, dc: number, dr: number): number {
  let n = 0
  let { col, row } = at
  while (water.has(`${col + dc},${row + dr}`)) {
    col += dc
    row += dr
    n++
  }
  return n
}

/**
 * WHICH AUTHORED SPAN CROSSES THIS RIVER: the smallest one that covers the water plus a landing each side.
 *
 * This used to walk DOWN from `runLength` and take the first span that fit, so it always picked the largest
 * bridge the landing-to-landing run allowed. Measured across 3 courses x 3 layouts x 8 seeds, that put 35 of
 * 118 crossings on the longest authored span; choosing by the river instead puts 28 there and moves the rest
 * onto spans that match their water.
 *
 * The down-walk survives as the FALLBACK, and it has to. `waterWidth` is read from the wet run, which on a
 * diagonal reach can be longer than the deck run, so nothing authored is long enough. Dropping out there left
 * 11 of those 118 crossings with a bare deck and no structure on it. A slightly short bridge reads as a
 * bridge; a deck with nothing on it does not.
 *
 * Pure, and takes `authored` as a predicate, so the choice can be tested without a tileset.
 */
export function chooseBridgeSpan(waterWidth: number, runLength: number, authored: (span: number) => boolean): number | null {
  // JUST THE BRIDGE.
  //
  // What it wants is the water plus one landing on each bank, and nothing else. What it did was fall back to
  // `runLength`, the length of the whole DECK RUN, and count DOWN from there: a path that meets the river at
  // an angle has a long run, so a two-cell creek got a seven-cell bridge. The run is a limit, not a target.
  //
  // So it searches OUTWARD from what is needed and takes the CLOSEST authored span, up only as far as the run
  // allows and down only as far as a bridge still reads as one.
  const needed = Math.max(MIN_BRIDGE_SPAN, Math.min(waterWidth + 2, Math.max(MIN_BRIDGE_SPAN, runLength)))
  for (let out = 0; out <= runLength; out++) {
    const longer = needed + out
    if (longer <= runLength && authored(longer)) return longer
    const shorter = needed - out
    // Still bounded by the run: a bridge longer than the deck it sits on is not a bridge, which is what the
    // "too short for even the minimum" case asserts.
    if (shorter >= MIN_BRIDGE_SPAN && shorter <= runLength && authored(shorter)) return shorter
  }
  return null
}

/** The pure half of `crossingStyle`. `random` picks one of the served kinds; an option the map was not built
 *  with (an older recipe) keeps the classic deck, so a saved map does not change under anyone. */
export function resolveCrossing(
  value: GeneratorOptionValue | undefined,
  crossings: Readonly<Record<string, GeneratorCrossing>> | undefined,
  rand: Rng,
): GeneratorCrossing | undefined {
  if (!crossings || typeof value !== 'string') return undefined
  if (value !== 'random') return crossings[value]
  const kinds = Object.keys(crossings)
  return kinds.length > 0 ? crossings[kinds[randIntWith(rand, 0, kinds.length - 1)]] : undefined
}

/**
 * THE KIND OF CROSSING. bridges" that we use on rivers, we must have multiple variations too / it can be a simple
  * dirt path, it can be an actual bridge, which again, are multiple variations"*. One per map, so every crossing on
  * it matches, picked the first time a deck is laid.
 */
export function crossingStyle(ctx: RiverCrossings): GeneratorCrossing | undefined {
  if (ctx.crossing === undefined) ctx.crossing = resolveCrossing(ctx.options?.bridge, ctx.crossings, ctx.rand) ?? null
  return ctx.crossing ?? undefined
}

// ── the deck ──────────────────────────────────────────────────────────────
// What actually gets you across. The widest seam in this module, and honestly so: laying a deck has to clear
// what is standing on those cells, flatten the bed it spans, repaint it and record the structure, so it needs
// the props, the trees and the composition list. A narrower seam here would be a lie.

/** What a map hands over to have a crossing laid on it. */
export interface RiverDeck extends RiverCarve, RiverCrossings {
  /** Every cell a deck covers, so later passes know not to plant on one. */
  decks: Set<string>
  trees: Array<{ col: number; row: number }>
  props: Array<{ col: number; row: number }>
  compositions: Array<{ kind: string; col: number; row: number; variant?: number; rotation?: number }>
}

/**
 * Clear a deck's cells of anything standing on them.
 *
 * The generator has a `clearMeadowCells` that does this and is used in nine places, so it is a general helper
 * whose name lies rather than a river thing. Pulling it in here to share it would have put a
 * clear-any-cells utility inside the RIVER, which is the wrong home for it. Five lines that belong to the deck
 * are cheaper than an abstraction in the wrong place.
 */
function clearForDeck(ctx: RiverDeck, keys: ReadonlySet<string>): void {
  ctx.trees.splice(0, ctx.trees.length, ...ctx.trees.filter(t => !keys.has(`${t.col},${t.row}`)))
  ctx.props.splice(0, ctx.props.length, ...ctx.props.filter(p => !keys.has(`${p.col},${p.row}`)))
  for (const key of keys) {
    const { col, row } = toCell(key)
    if (inBounds(col, row, ctx.cols, ctx.rows)) ctx.collision[row][col] = false
  }
}

/** What colour a deck cell wears: the served crossing's own, else whatever tone the layout passed, else
 *  nothing at all so the tile's served colour shows through. Never the water it replaced. */
function deckTone(style: GeneratorCrossing | undefined, col: number, row: number, tone: string | undefined): string | undefined {
  if (!style) return tone
  return groundTileColor(style.colorOf ?? style.tile, col, row) || undefined
}

export function layDeck(ctx: RiverDeck, deck: Set<string>, tone: string | undefined): void {
  const { cols, rows, ground, collision, floorColors } = ctx
  const style = crossingStyle(ctx)
  clearForDeck(ctx, deck)
  for (const key of deck) {
    const { col, row } = toCell(key)
    if (!inBounds(col, row, cols, rows)) continue
    // NOT YET: THE WATER DOES NOT STAY UNDER THE DECK. and it is right, but keeping the cell wet here is not the way
    // to get there.
    //
    // Tried and reverted, measured: leaving the deck cells as water broke four documented invariants at once.
    // `divides` went from one crossing to two (the wadeable shallows the extra water created became a second
    // way over), and "the river is cut below the walking floor" failed, because a deck cell is forced to
    // elevation 0 while a river cell is dug below it. Those two facts cannot both hold on one cell.
    //
    // The real fix is for the deck COMPOSITION to be lifted to the bank's level over a cell that stays river,
    // which is a change to how the stamp picks its level, not to what the ground says. Ticket 105.
    ground[row][col] = style?.tile ?? 'bridge'
    collision[row][col] = false
    ctx.decks.add(key)
    // A DECK SPANS THE CHANNEL, it does not lie in the bottom of it. The dig runs inside `carveChannel`, which
    // is before any crossing is laid, so a deck cell was still carrying the bed's negative elevation and a
    // bridge came out sunk in the water. Measured on a `divides` river: 14 of its cells.
    ctx.elevation[row][col] = 0
    // A DECK NEVER KEEPS THE WATER'S COLOUR.
    //
    // This cell was river a moment ago and `floorColors` still held the river's blue. The old branch was
    // `else if (tone)`, so a deck with no served tone was LEFT wearing it: the tile said bridge, the colour
    // said water, and you got a blue walkway over a blue river.
    //
    // Clearing it is not the hardcoded fallback the old comment worried about. An undefined override means
    // "no override", so the bridge tile's OWN served colour shows through, which is the data doing its job.
    // Inventing a brown here would have been the violation; leaving a stale blue was just a bug.
    floorColors[row][col] = deckTone(style, col, row, tone)
  }
}

/**
 * PLANK THE WAY WHERE IT CROSSES WATER.
 *
 * with the swamp (image #18) as the example, the boardwalk over the pools IS the pathway there.
 *
 * The water is carved without knowing where the paths run, so a creek or a pool can land straight on a gate and
 * leave a way out that nobody can use (measured: three jungle seeds in eight). Every planned cell that came out
 * wet gets a deck, which is the same crossing the map uses everywhere else, so it wears the served kind too.
 */
export function deckRoutes(
  ctx: RiverDeck,
  plan: RoutePlan,
  water: ReadonlySet<string>,
  tone: string | undefined,
  network?: Set<string>,
  required?: ReadonlySet<string>,
): void {
  // The cells the layout actually CUT as a way, and the planned centreline for a layout that records none.
  // The same rule `pavableLane` uses, because it has to be the same answer: what gets decked and what gets
  // paved are two halves of one way. A layout that records its network is narrowed IN PLACE, so a cell that
  // stops being a crossing stops being a way, and every later pass sees open river rather than a path.
  const cut = network && network.size > 0 ? network : new Set(plan.cells)
  // NARROW IT TO THE CROSSINGS FIRST, which is what `narrowPathwaysToCrossings` was written for and what
  // nothing called. Every wet cell of the route plan was planked, so a way that ran along the channel came out
  // as a plank road down the middle of the river, and a network that crossed the same river three times got
  // three separate decks joining the same two banks. Measured on a woodland: 85 deck cells in 3 runs.
  //
  // It is given the WHOLE network on purpose. Deciding whether a crossing can go means asking whether the way
  // survives without it, and a set holding only the wet cells cannot answer that.
  narrowPathwaysToCrossings(ctx, cut, water, required)
  const wet = new Set<string>()
  for (const key of cut) if (water.has(key)) wet.add(key)
  // AND A PROMISED DESTINATION IS ALWAYS STANDABLE. A route plan is laid on dry ground and the water is
  // carved over it, so a gate mouth or a dead-end stop can end up inside the channel. The narrowing is right
  // to refuse it a crossing (it touches one bank, which is a spur into the river rather than a way over it)
  // and the cell still has to be reachable, because the network promises you can get there.
  //
  // This is the cell itself, not a stretch: one plank to stand on where the planner put the end of a path in
  // the water. The planner placing it on dry ground instead is the better fix and it is a different layer.
  for (const key of required ?? []) if (water.has(key)) wet.add(key)
  if (wet.size === 0) return
  layDeck(ctx, wet, tone)
  for (const run of crossingRuns(wet)) recordCrossingStructure(ctx, run, water)
}

/** The deck cells split into the separate crossings they form, one group per place you can get over. */
function crossingRuns(deck: ReadonlySet<string>): Set<string>[] {
  const seen = new Set<string>()
  const out: Set<string>[] = []
  for (const start of deck) {
    if (seen.has(start)) continue
    const run = new Set<string>([start])
    const stack = [start]
    seen.add(start)
    while (stack.length > 0) {
      const { col, row } = toCell(stack.pop() as string)
      for (const [dc, dr] of ORTHO) {
        const key = cellKey(col + dc, row + dr)
        if (!deck.has(key) || seen.has(key)) continue
        seen.add(key)
        run.add(key)
        stack.push(key)
      }
    }
    out.push(run)
  }
  return out
}

/**
 * PUT THE BRIDGE ON THE CROSSING, which is the step that was missing entirely.
 *
 * `recordBridgeSpan` was only ever reached from `placeRiverCrossing` and `crossRiver`, and on the generated
 * maps neither of them got there: measured across every forest template, every river course and every value
 * of the served `bridge` option including `stone` and `wood` outright, the answer was the same. Decks laid,
 * 21 to 57 cells of them, and ZERO bridge compositions. The object existed in the catalogue and no map could
 * reach it, which is why a bridge could stay broken for as long as it did without ever being seen in place.
 *
 * Here is where it belongs now. The crossing is whatever `narrowPathwaysToCrossings` kept, and that pass
 * already guarantees the one thing `recordBridgeSpan` needs: a straight run widened to exactly CROSSING_ROWS,
 * which is the rectangle a bridge composition is authored on.
 */
function recordCrossingStructure(ctx: RiverDeck, run: ReadonlySet<string>, water: ReadonlySet<string>): void {
  const cells = [...run].map(toCell)
  const cols = new Set(cells.map(c => c.col))
  const rows = new Set(cells.map(c => c.row))
  // Which way it SPANS: the axis it covers more of. A crossing is longer across the channel than along it.
  const spanAlongCol = cols.size >= rows.size
  const wet = [...run].filter(key => water.has(key))
  if (wet.length === 0) return
  // How wide the WATER is under it, not how long the run is: the span is sized to the river so a 4-wide
  // channel does not get a 7-span bridge.
  const wetCells = wet.map(toCell)
  const waterWidth = spanAlongCol
    ? new Set(wetCells.map(c => c.col)).size
    : new Set(wetCells.map(c => c.row)).size
  recordBridgeSpan(ctx, run, spanAlongCol, waterWidth)
}

/**
 * RECORD A BRIDGE over a deck run. with a wooden arch, a steel truss and a sheet of ten
 * variations.
 *
 * The flat deck STAYS. It is laid first by the caller and this adds the structure on top, which keeps every
 * connectivity guarantee intact (a crossing is still a crossing whatever span the river turns out to be) and
 * means no run can come out uncrossable because no composition happened to fit it.
 *
 * The span is asked of the CATALOG, descending, rather than read from a list here: whatever spans the backend
 * ships are the spans used, so authoring `bridge_wood_9` needs no frontend change. A crossing that names no
 * composition records nothing, which is how a DIRT PATH stays a path (the #62, ).
 *
 * Rotation: a bridge is authored `span x 3` running along +dx, so a deck lying along +row turns one quarter
 * (`rotateOffsetCW` maps it to `3 x span`, anchor still top-left). The anchor is the run's top-left corner,
 * nudged by half the slack so the abutments sit on the landings rather than in the water.
 */
export function recordBridgeSpan(
  ctx: RiverDeck,
  deck: ReadonlySet<string>,
  spanAlongCol: boolean,
  waterWidth: number,
): void {
  const family = crossingStyle(ctx)?.composition
  if (!family) return
  const cells = [...deck].map(toCell).filter(c => inBounds(c.col, c.row, ctx.cols, ctx.rows))
  if (cells.length === 0) return
  const minCol = Math.min(...cells.map(c => c.col))
  const minRow = Math.min(...cells.map(c => c.row))
  const runLength = spanAlongCol
    ? Math.max(...cells.map(c => c.col)) - minCol + 1
    : Math.max(...cells.map(c => c.row)) - minRow + 1
  // A BRIDGE ONLY GOES ON A DECK WIDE ENOUGH TO HOLD IT. The composition is CROSSING_ROWS rows deep (a rail,
  // two walking rows, a rail), so a narrower deck means a rail is stamped off the end of it, floating over
  // the water beside the crossing. That is what a ford gets instead: a plain deck and no structure, which is
  // honest, rather than a bridge with a rail hanging off one side.
  const across = spanAlongCol
    ? Math.max(...cells.map(c => c.row)) - minRow + 1
    : Math.max(...cells.map(c => c.col)) - minCol + 1
  if (across < CROSSING_ROWS) return
  // SIZE THE BRIDGE TO THE RIVER, not to the deck run. and
  //
  // This used to walk DOWN from `runLength` and take the first span that fit, so it always picked the largest
  // authored bridge the landing-to-landing run allowed, which is how a 4-wide river got a 7-span. It now walks
  // UP and takes the SMALLEST authored span that covers the water plus one landing each side. Spans 4 and 6 are
  // authored in the backend for exactly this, so a 3-wide river lands on 5 and a 4-wide on 6 rather than both
  // rounding up to 7.
  const span = chooseBridgeSpan(waterWidth, runLength, s => resolveComposition(styleCatalog('ascii'), `${family}_${s}`) !== null)
  if (span === null) return
  const offset = Math.floor((runLength - span) / 2)
  ctx.compositions.push({
    kind: `${family}_${span}`,
    col: spanAlongCol ? minCol + offset : minCol,
    row: spanAlongCol ? minRow : minRow + offset,
    variant: 0,
    rotation: spanAlongCol ? 0 : 1,
  })
}

// ── the surface ───────────────────────────────────────────────────────────
// Everything the water does to ITSELF once the channel is cut and the crossings are laid: how deep each cell
// reads, which way it runs, where you can wade it and what is standing in it. It runs LAST, after the trails
// and the bridges, so nothing before it has to know that water has depth at all.

/** A prop as the RIVER needs to see one. The stage's own prop carries more (building edges, footprints,
 *  storeys), none of it the river's business, so the seam asks for the part a rock actually uses. */
export interface RiverProp {
  col: number
  row: number
  type: string
  char: string
  blocking: boolean
  color: string
  label?: string
}

/** What a map hands over to have its water settled. */
export interface RiverSurface extends RiverCarve {
  /** Read for the frozen case only, and that is a stopgap: see the note in `settleWaterDepth`. */
  zone: ZoneId
  /** Cells a crossing covers. Not banks, so the water beside a deck stays as deep as the river around it. */
  decks: ReadonlySet<string>
  /**
   * CELLS WHERE THE RIVER IS SHALLOW ENOUGH TO WALK THROUGH.
   *
   * A ford is not a deck and the two cannot share a set. A deck is DRY planking standing over the water, so
   * the depth pass treats it as neither bank nor channel and the flow walk bridges across it. A ford IS the
   * river, just not deep: it keeps its label, its colour and its current, and the only thing that changes is
   * that it sits flush with its banks and lets you through.
   *
   * Recorded separately because three passes ask different questions of a crossing and get the wrong answer
   * for a ford from `decks`: the depth walk would read it as a gap in the channel, `dryAreas` would count it
   * as land, and `wadeableShallows` would refuse it along with every other cell of a cut channel.
   */
  fords: ReadonlySet<string>
  /** Cells wearing a film of water over dry ground (a puddle). Not banks either. */
  wet: ReadonlySet<string>
  /** Which way each channel cell runs, written here and read by the renderer to turn the tile's picture. */
  flow: Map<string, number>
  props: RiverProp[]
}

/** How many channel cells in get a rock, as a share. Sparse on purpose: */
const RIVER_ROCK_SHARE = 0.035
/** A rock never sits on the bank edge, or it reads as part of the shore instead of standing in the water. */
const ROCK_MIN_WATER_NEIGHBOURS = 4

/**
 * A FEW ROCKS IN THE RIVER.
 *
 * The cell STAYS WATER. That is the whole point of the note: the rock is something standing IN the river, so
 * the water keeps its label, its colour and its current, and the rock is a prop on top of it that you cannot
 * walk through. Every other prop pass refuses a water cell (`isLandCell`, and rightly, a flower has no
 * business floating), so this pushes directly rather than going through `placeProp`.
 *
 * Only well-inside cells qualify: a rock needs water on all four sides or it reads as a lump of the bank.
 */
export function strewRiverRocks(ctx: RiverSurface, channel: ReadonlySet<string>): void {
  const rock = resolveTile(styleCatalog('ascii'), ctx.zone, 'rock')
  const midstream = [...channel].filter(key => {
    const { col, row } = toCell(key)
    return FLOW_STEPS.filter(([dc, dr]) => channel.has(`${col + dc},${row + dr}`)).length >= ROCK_MIN_WATER_NEIGHBOURS
  })
  for (const key of midstream) {
    if (ctx.rand() >= RIVER_ROCK_SHARE) continue
    const { col, row } = toCell(key)
    // ONLY WHERE THE WATER ALREADY BLOCKS. A rock is solid, and dropping a fresh blocker into a channel can
    // sever the map: placing them freely broke "however dense it gets, the jungle is ONE place" eight times
    // over, and pinched a wadeable ford shut. Standing one in water you could not cross anyway adds the look
    // was asked for and cannot change what connects to what.
    if (!ctx.collision[row][col]) continue
    ctx.props.push({ col, row, type: 'rock', char: rock.char, label: 'rock', blocking: true, color: rock.color })
  }
}

/**
 * Which bank-side cells you may WADE. One only when it hangs off exactly ONE stretch of dry ground, so the
 * shallows can never become a way across: banks the river keeps apart stay apart, and the bridge stays THE
 * crossing. Measured without this: a narrow river is shallow on both sides with nothing left between, and a
 * "divides" map could be waded straight over. A cell touching no walkable ground (only trunks or rocks) stays
 * open water too, or it would be a puddle you could never reach.
 *
 * Grown outward from the banks until nothing more can join, so a shallow cell can hang off another one.
 */
export function wadeableShallows(ctx: RiverSurface, depth: ReadonlyMap<string, number>): Set<string> {
  // YOU CANNOT WADE INTO A CUT. Where the channel is dug, the bank stands a whole block above the water and
  // the rim is a wall you would have to climb down, so the water there blocks and the crossing is the way
  // over. Wading survives exactly where the river is flush with its bank (an undug channel, and the
  // perimeter course), which is where stepping in actually makes sense.
  //
  // Measured before this: 68 of 159 wet cells were open on a one-block cut, so a walker stepped off a
  // 0.65-block bank straight into the river.
  // EXCEPT AT A FORD, which is the one place the channel is not cut: it was raised back to the level of its
  // banks when it was laid, so there is no rim to climb and walking through is the whole point of it. Without
  // this the cut check below refuses every cell of a cut river and a jungle comes apart at its creek.
  if (channelDepth(ctx) > 0) return new Set(ctx.fords)
  const area = dryAreas(ctx)
  const joined = new Map<string, number>()
  const pending = new Set([...depth].filter(([, d]) => d === 1).map(([key]) => key))
  for (let grew = true; grew;) {
    grew = false
    for (const key of pending) {
      const { col, row } = toCell(key)
      const touching = new Set<number>()
      for (const [dc, dr] of ORTHO) {
        const id = area.get(`${col + dc},${row + dr}`) ?? joined.get(`${col + dc},${row + dr}`)
        if (id !== undefined) touching.add(id)
      }
      if (touching.size === 0) continue
      pending.delete(key)
      if (touching.size > 1) continue
      joined.set(key, [...touching][0])
      grew = true
    }
  }
  return new Set([...joined.keys(), ...ctx.fords])
}

/**
 * WHERE THE CHANNEL TURNS: the cells whose current changes axis.
 *
 * Water is not linear. It runs straight down a reach and BENDS at a corner, and a bend drawn with the
 * straight picture turned a quarter is the stepped `-----| | |` a river never makes. A bend cell wears its
 * own picture, whose lines curve from one edge to the next.
 *
 * A cell is a bend when the cell its current flows INTO runs on the other axis: that next cell is where the
 * turn happens, so that is the one that gets the corner.
 */
export function bendCells(flow: ReadonlyMap<string, number>, water: ReadonlySet<string>): Set<string> {
  const axis = (dir: number): number => dir % 2 // 0 = along col, 1 = along row
  const bends = new Set<string>()
  for (const [key, dir] of flow) {
    const { col, row } = toCell(key)
    const [dc, dr] = FLOW_STEPS[dir]
    const next = cellKey(col + dc, row + dr)
    if (!water.has(next)) continue
    const onward = flow.get(next)
    if (onward === undefined || axis(onward) === axis(dir)) continue
    bends.add(next)
  }
  return bends
}

/**
 * SETTLE THE WATER BY DEPTH, once the map is otherwise finished.
 *
 *   · the edge you can WADE is shallow: light blue, walkable
 *   · past it the water is ordinary, and further in DEEP and darker; both block
 *   · a swamp pool stays as it is (blocking), recoloured blue-green
 *
 * It runs LAST, after the trails, the bridges and the connectivity joins. Everything before it still sees plain
 * water, so none of that logic changes, and the shallows are only ever hung off ground you could already reach
 * (`wadeableShallows`), so no map comes out more or less connected than it went in.
 */
export function settleWaterDepth(ctx: RiverSurface, pal: GeneratorPalette | undefined, pools: ReadonlySet<string> = new Set()): void {
  const { ground, collision, floorColors } = ctx
  const depth = waterDepth(ctx, pools)

  // WHICH WAY IT RUNS, decided once for the whole reach. Only the CHANNEL gets one: a pool is standing water
  // and standing water has no current, which is the own distinction.
  const channel = new Set<string>()
  forEachCell(ctx.cols, ctx.rows, (col, row) => {
    if (isWaterGround(ground[row][col]) && !pools.has(`${col},${row}`)) channel.add(`${col},${row}`)
  })

  // THE RIVER RUNS UNDER THE BRIDGE, so the flow walk is given the deck cells too.
  //
  // A deck REPLACES the water in the ground (`layDeck` documents why: a cell cannot be both dug below the
  // floor and forced to elevation 0). The channel above is built from ground labels, so a crossing cut the
  // river in two and `flowField` walked each half on its own and gave them OPPOSITE headings. Measured on a
  // `divides` river once crossings became unconditional: 93 cells heading 0 against 52 heading 2, where a
  // straight channel should be one heading at over 90 per cent.
  //
  // The deck is not added to `ctx.flow` itself: it is dry, and a dry cell has no current. It is only in the
  // set the walk uses to see that the two halves are one river.
  const flowing = new Set(channel)
  for (const key of ctx.decks) flowing.add(key)
  for (const [key, dir] of flowField(ctx, flowing)) {
    if (!channel.has(key)) continue
    ctx.flow.set(key, dir)
  }
  strewRiverRocks(ctx, channel)
  const wadeable = wadeableShallows(ctx, depth)
  // FROZEN OVER. `frozen_water` already exists as
  // a label in both styles, named for exactly this, so the season lays a different TILE rather than the same
  // water with an exception bolted on.
  //
  // HONEST ABOUT WHERE THIS BELONGS: reading the season here is the same shape of frontend conditional the data
  // audit indicts elsewhere. The durable home is a served answer on the tile, which is also what makes the ice
  // physics possible later. It reads the zone for now because nothing serves it yet.
  const frozen = ctx.zone === 'winter'
  // ONE SURFACE COLOUR for the whole channel.
  // after
  //
  // MEASURED before changing it, on a seed-5 `divides` river: 120 cells `#4f93b3`, 108 `#8ccbe8`, 38 `#2a5f8a`
  // three blues at 45/41/14% inside ONE river. And all three drew the SAME picture, because a floor resolves
  // its art through `groundKind`, which collapses every band to `water`. So the bands were never different
  // water; they were one tile wearing three tints. The "bottom" colour it asks for is the map BODY beneath the
  // surface, which `groundSideColor` already derives from it, so one tone here delivers both halves of the rule.
  //
  // THIS REVERSES the per-depth shading was asked for on 2026-09-11 (). The newest instruction wins. The band still
  // decides the LABEL and what you can wade through, so the shallows stay walkable. They just stop being a
  // different colour, which means the wadeable edge now needs the shoreline to mark it, not a hue.
  // WHERE IT TURNS. Read before the bands are laid, off the flow that was just written, so a bend keeps the
  // depth it had and only swaps the picture it draws with.
  const bends = frozen ? new Set<string>() : bendCells(ctx.flow, channel)
  for (const [key, d] of depth) {
    const { col, row } = toCell(key)
    const band = waterBand(d)
    ground[row][col] = frozen ? 'frozen_water' : bends.has(key) ? 'water_bend' : band.label
    // The BAND is the label; whether you can stand here is `wadeableShallows`, which refuses a cut channel.
    collision[row][col] = frozen ? false : !wadeable.has(key)
    if (pal?.water) floorColors[row][col] = pal.water
  }
  if (!pal?.swamp) return
  for (const key of pools) {
    const { col, row } = toCell(key)
    // WATER-GROUND, not one spelling of it. This tested `=== 'water'` and silently stopped applying the swamp
    // tone the moment a pool started laying `water_shallow` (its flush height), so every pool came out wearing
    // the plain river blue. The rule is written twenty lines up in this very file: ask what the ground IS, never
    // which of its names it happens to carry.
    if (isWaterGround(ground[row]?.[col])) floorColors[row][col] = pal.swamp
  }
}

// A band decides the LABEL and whether you can wade it. It used to decide a COLOUR too (`tone`), which is what
// put three blues in one river; the surface now takes one served tone (see settleWaterDepth).

/**
 * How far each channel cell is from the nearest bank, counted orthogonally (1 = touching it). A bridge is not a
 * bank, so the water beside a deck keeps the depth of the river around it instead of ringing the deck with
 * shallows. The map edge is not a bank either, so a river running off the map stays deep there. Swamp pools are
 * left out, they are their own kind of water.
 */
function waterDepth(ctx: RiverSurface, pools: ReadonlySet<string>): Map<string, number> {
  const { cols, rows, ground } = ctx
  // The CHANNEL is water that is not a pool. `pools` already excludes them explicitly, so this is the same
  // answer as before; it asks what the ground is rather than which name it wears, for the same reason as above.
  const isChannel = (c: number, r: number) => inBounds(c, r, cols, rows) && isWaterGround(ground[r][c]) && !pools.has(`${c},${r}`)
  // A BANK is dry land. Testing `!== 'water'` made a swamp POOL count as a bank the moment pools started
  // laying `water_shallow`, which would have made the channel read as shallow wherever a puddle touched it.
  // …AND NOT A PUDDLE EITHER. The warning above came true from the other direction: a pool no longer carries a
  // water GROUND label (it is a film over dry ground), so without this every puddle touching the channel would
  // count as its bank and shallow the river there.
  const isBank = (c: number, r: number) =>
    inBounds(c, r, cols, rows) && !isWaterGround(ground[r][c]) && !ctx.decks.has(`${c},${r}`) && !ctx.wet.has(`${c},${r}`)
  const depth = new Map<string, number>()
  const queue: Cell[] = []
  // A FORD IS AS SHALLOW AS THE RIVER GETS, wherever it lies. The walk grows depth inward from the banks, so
  // a crossing out in midstream would otherwise be handed the depth of the middle of the river and come out
  // wearing the deep band. Seeding it at 1 says the shallow thing directly rather than hoping the geometry
  // agrees, and it still spreads outward from here like any other shallow cell.
  for (const key of ctx.fords) {
    const { col, row } = toCell(key)
    if (!isChannel(col, row)) continue
    depth.set(key, 1)
    queue.push({ col, row })
  }
  forEachCell(cols, rows, (col, row) => {
    if (!isChannel(col, row) || depth.has(`${col},${row}`)) return
    if (!ORTHO.some(([dc, dr]) => isBank(col + dc, row + dr))) return
    depth.set(`${col},${row}`, 1)
    queue.push({ col, row })
  })
  for (let i = 0; i < queue.length; i++) {
    const { col, row } = queue[i]
    const next = depth.get(`${col},${row}`)! + 1
    for (const [dc, dr] of ORTHO) {
      const c = col + dc
      const r = row + dr
      if (!isChannel(c, r) || depth.has(`${c},${r}`)) continue
      depth.set(`${c},${r}`, next)
      queue.push({ col: c, row: r })
    }
  }
  return depth
}

/** Every walkable dry cell, labelled by the stretch of ground it belongs to. Bridges are left out on purpose:
 *  the question is what the WATER keeps apart. */
function dryAreas(ctx: RiverSurface): Map<string, number> {
  const { cols, rows, ground, collision } = ctx
  // KNOWN, AND LEFT ALONE HERE: this asks `!== 'water'` where `waterDepth` right above asks `isWaterGround`,
  // which is the exact trap that file documents twice. A swamp pool laying `water_shallow` counts as dry LAND
  // to this function, so it can act as a bank for the shallows growing beside it. Changing it changes what
  // every seeded map comes out as, so it is a fix with a before/after to look at, not a line to slip into a
  // move. Recorded here so it stops being invisible.
  const isDry = (c: number, r: number) =>
    inBounds(c, r, cols, rows) && !collision[r][c] && ground[r][c] !== 'water' && !ctx.decks.has(`${c},${r}`) && !ctx.fords.has(`${c},${r}`)
  const seen = new Set<string>()
  const area = new Map<string, number>()
  let next = 0
  forEachCell(cols, rows, (col, row) => {
    if (!isDry(col, row) || seen.has(`${col},${row}`)) return
    const id = next++
    for (const key of flood(isDry, col, row, seen)) area.set(key, id)
  })
  return area
}

// ── the pathways the water landed on ──────────────────────────────────────────
// The paths are planned before a drop of water is carved, so a river can land ON one. Everything downstream
// then treats those cells as "a way that happens to be wet" and planks them, which is how a bridge turns into
// a causeway. This pass is the river admitting what it did to the road.

/**
 * How many cells a crossing is wide, ACROSS the way.
 *
 * This is not a free choice: it has to be the number of rows the bridge composition authors, or the
 * structure and the flat deck under it disagree and part of the bridge lands off the deck. `bridge_cells`
 * builds a rail row, two walking rows and a rail row, so a crossing is FOUR cells across and the two middle
 * ones are the way over.
 *
 * It was 3 (a kept line plus one cell either side), so the fourth row of every bridge was stamped onto the
 * water beside the deck and the rail floated there on its own.
 */
export const CROSSING_ROWS = 4

/** Every cell of the map that is NOT water, labelled by the stretch of dry ground it belongs to. The BANKS. */
function bankLabels(bounds: RiverBounds, water: ReadonlySet<string>): Map<string, number> {
  const dry = (col: number, row: number): boolean =>
    inBounds(col, row, bounds.cols, bounds.rows) && !water.has(cellKey(col, row))
  const seen = new Set<string>()
  const banks = new Map<string, number>()
  let next = 0
  forEachCell(bounds.cols, bounds.rows, (col, row) => {
    if (!dry(col, row) || seen.has(cellKey(col, row))) return
    const id = next++
    for (const key of flood(dry, col, row, seen)) banks.set(key, id)
  })
  return banks
}

/** The wet cells of `pathways`, split into the separate puddles and stretches they form. */
function wetStretches(pathways: ReadonlySet<string>, water: ReadonlySet<string>): Set<string>[] {
  const wet = new Set<string>()
  for (const key of pathways) if (water.has(key)) wet.add(key)
  const seen = new Set<string>()
  const out: Set<string>[] = []
  for (const key of wet) {
    if (seen.has(key)) continue
    const found = new Set<string>([key])
    const stack = [key]
    seen.add(key)
    while (stack.length > 0) {
      const { col, row } = toCell(stack.pop() as string)
      for (const [dc, dr] of ORTHO) {
        const k = cellKey(col + dc, row + dr)
        if (!wet.has(k) || seen.has(k)) continue
        seen.add(k)
        found.add(k)
        stack.push(k)
      }
    }
    out.push(found)
  }
  return out
}

/** Which bank each cell of `stretch` touches, as bank id -> the stretch cells that touch it. */
function shoresOf(stretch: ReadonlySet<string>, banks: ReadonlyMap<string, number>): Map<number, string[]> {
  const shores = new Map<number, string[]>()
  for (const key of stretch) {
    const { col, row } = toCell(key)
    for (const [dc, dr] of ORTHO) {
      const bank = banks.get(cellKey(col + dc, row + dr))
      if (bank === undefined) continue
      const at = shores.get(bank)
      if (at) { at.push(key); continue }
      shores.set(bank, [key])
    }
  }
  return shores
}

/** The shortest way through `stretch` from one bank to another, staircase and all. Only used when no
 *  straight line joins the two, which happens on a stretch that bends inside the channel. Narrow but not
 *  rectangular, so it carries no bridge structure: it is a ford, and a ford beats keeping the whole stretch. */
function shortestThrough(stretch: ReadonlySet<string>, from: readonly string[], to: readonly string[]): Set<string> {
  const target = new Set(to)
  const came = new Map<string, string | null>()
  const queue: string[] = []
  for (const key of from) {
    if (came.has(key)) continue
    came.set(key, null)
    queue.push(key)
  }
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i]
    if (target.has(key)) {
      const path = new Set<string>()
      for (let at: string | null | undefined = key; at; at = came.get(at)) path.add(at)
      return path
    }
    const { col, row } = toCell(key)
    for (const [dc, dr] of ORTHO) {
      const k = cellKey(col + dc, row + dr)
      if (!stretch.has(k) || came.has(k)) continue
      came.set(k, key)
      queue.push(k)
    }
  }
  return new Set(from.slice(0, 1))
}

/**
 * The shortest STRAIGHT run through `stretch` from one bank to another, as the cells it passes.
 *
 * It used to be a breadth-first shortest path, which is shortest but staircases across a diagonal river. A
 * bridge is a RECTANGLE, so a staircased deck means part of every bridge is stamped off the deck and the
 * rails float beside it over the water. A crossing goes straight across or it is not a crossing.
 *
 * Returns null when no straight line from this bank reaches that one, and the caller keeps the stretch rather
 * than severing it.
 */
function straightThrough(
  stretch: ReadonlySet<string>,
  from: readonly string[],
  toBank: number,
  banks: ReadonlyMap<string, number>,
): { cells: Set<string>; step: readonly [number, number] } | null {
  let best: { cells: Set<string>; step: readonly [number, number] } | null = null
  for (const start of from) {
    const { col, row } = toCell(start)
    for (const step of ORTHO) {
      const cells = new Set<string>()
      let c = col
      let r = row
      while (stretch.has(cellKey(c, r))) {
        cells.add(cellKey(c, r))
        c += step[0]
        r += step[1]
      }
      // The cell it walked out onto has to be the bank we were trying to reach.
      if (banks.get(cellKey(c, r)) !== toBank) continue
      if (!best || cells.size < best.cells.size) best = { cells, step }
    }
  }
  return best
}

/**
 * Widen a straight crossing ACROSS its own direction into the rectangle the bridge needs.
 *
 * It must come out EXACTLY `rows` wide, because that is how many rows the bridge composition authors and a
 * band one short leaves a rail hanging over the water beside the deck (measured: a 3-wide band under a
 * 4-row bridge put one rail off the deck on every crossing).
 *
 * So it does not simply grow until it runs out of water. It scores every window of `rows` consecutive
 * offsets around the line by how much of it is water, and takes the best one: the band covers the channel
 * where it can and steps onto the bank where it must, which is what an abutment is anyway. Ties go to the
 * window nearest the line, so a crossing stays centred on the run it was chosen for.
 */
function widenAcross(
  line: ReadonlySet<string>,
  step: readonly [number, number],
  stretch: ReadonlySet<string>,
  bounds: RiverBounds,
  rows: number,
): Set<string> {
  const [ac, ar] = [-step[1], step[0]] // a quarter turn from the run
  const cells = [...line].map(toCell)
  /** How much water a band at offsets [from, from+rows) would cover, and how far it sits off the line. */
  const score = (from: number): { wet: number; drift: number } => {
    let wet = 0
    for (const { col, row } of cells) {
      for (let n = from; n < from + rows; n++) {
        if (stretch.has(cellKey(col + ac * n, row + ar * n))) wet++
      }
    }
    return { wet, drift: Math.abs(from) + Math.abs(from + rows - 1) }
  }
  let best = 1 - rows
  let bestScore = score(best)
  for (let from = 2 - rows; from <= 0; from++) {
    const s = score(from)
    if (s.wet > bestScore.wet || (s.wet === bestScore.wet && s.drift < bestScore.drift)) {
      best = from
      bestScore = s
    }
  }
  const out = new Set<string>()
  for (const { col, row } of cells) {
    for (let n = best; n < best + rows; n++) {
      const c = col + ac * n
      const r = row + ar * n
      if (inBounds(c, r, bounds.cols, bounds.rows)) out.add(cellKey(c, r))
    }
  }
  return out
}

/**
 * KEEP THE CROSSING, DROP THE CAUSEWAY.
 *
 * And
 * The pathways are planned on dry ground, then the river is carved over them, and every way cell that came out wet
 * was planked. On a map whose pathways run the same direction as the channel that is a plank road down the middle
 * of the river: measured on a woodland, 85 deck cells against 105 water cells, 28 columns wide.
 *
 * So the river narrows each wet stretch of the network back to what a crossing IS:
 *
 *   · a stretch that touches only ONE bank goes entirely. It leads from the shore into the water and back to
 *     the same shore, which is a paddle, not a way.
 *   · a stretch that touches TWO OR MORE banks keeps the shortest line through it to each further bank, one
 *     cell either side so you are not walking a tightrope. Everything else goes.
 *
 * AND ONE CROSSING PER PAIR OF BANKS, not one per place the network happens to get wet.
 *
 * A route network planned on dry ground can wander over the same river three times, and each wet stretch was
 * narrowed and kept on its own, so a map came out with three separate crossings joining the same two pieces of
 * land. Two of them join nothing that is not already joined: they are structures standing in the water for no
 * reason, and they are what reads as a landscape littered with bridges.
 *
 * So the stretches are considered NARROWEST FIRST and a crossing is kept only when it joins two banks that
 * nothing has joined yet. On a river that cuts the map in two that is exactly one crossing. A river that forks
 * into three pieces gets two, because one is genuinely not enough, and a stretch that leaves one bank and
 * returns to it still goes entirely.
 *
 * Connectivity is kept BY CONSTRUCTION, and more tightly than before: a bank is a connected component of dry
 * land, so a spanning forest over those components reaches every one of them. What is dropped is only ever a
 * second way to somewhere already reachable.
 */
export function narrowPathwaysToCrossings(
  bounds: RiverBounds,
  pathways: Set<string>,
  water: ReadonlySet<string>,
  required: ReadonlySet<string> = new Set(),
): number {
  if (water.size === 0) return 0
  const banks = bankLabels(bounds, water)
  let dropped = 0
  // WIDEST FIRST, AND REQUIRED LAST. The question asked of each stretch is whether the network can do without
  // it, so the biggest swallowed stretches are offered up first and a stretch carrying an exit is only ever
  // asked once everything else has been settled around it.
  const wet = wetStretches(pathways, water)
    .map(stretch => ({ stretch, needed: carries(stretch, required) }))
    .sort((a, b) => (a.needed === b.needed ? b.stretch.size - a.stretch.size : a.needed ? 1 : -1))
  for (const { stretch, needed } of wet) {
    // CAN THE NETWORK DO WITHOUT THIS CROSSING ENTIRELY? Asked by taking it out and counting the pieces,
    // rather than reasoned about from the geometry. A crossing whose removal leaves the way in one piece is a
    // SECOND way to somewhere already reachable, and a landscape littered with those is what was reported.
    //
    // This replaces a spanning forest over the map's BANKS, which was the near miss: a bank is every dry cell
    // you could in principle stand on, so two crossings over the same two banks looked interchangeable when
    // the ground between them is whatever the map grew. Undergrowth is a wall. The way is what has to survive,
    // so the way is what gets counted.
    if (!needed && !severs(pathways, stretch)) {
      for (const key of stretch) {
        pathways.delete(key)
        dropped++
      }
      continue
    }
    // It is load bearing, so it stays, narrowed to what a crossing IS. A stretch that runs along the channel
    // is mostly plank road and only a little of it is the bit that gets you over.
    const keep = crossingThrough(stretch, shoresOf(stretch, banks), banks, bounds)
    for (const key of stretch) {
      if (keep.has(key)) continue
      pathways.delete(key)
      dropped++
    }
  }
  return dropped
}

/** Whether taking `stretch` out would break the network into more pieces than it is in now. */
function severs(pathways: ReadonlySet<string>, stretch: ReadonlySet<string>): boolean {
  const without = new Set<string>()
  for (const key of pathways) if (!stretch.has(key)) without.add(key)
  return pieces(without) > pieces(pathways)
}

/** How many connected pieces a set of cells is in, walking orthogonally. */
function pieces(cells: ReadonlySet<string>): number {
  const seen = new Set<string>()
  let n = 0
  for (const start of cells) {
    if (seen.has(start)) continue
    n++
    const stack = [start]
    seen.add(start)
    while (stack.length > 0) {
      const { col, row } = toCell(stack.pop() as string)
      for (const [dc, dr] of ORTHO) {
        const key = cellKey(col + dc, row + dr)
        if (!cells.has(key) || seen.has(key)) continue
        seen.add(key)
        stack.push(key)
      }
    }
  }
  return n
}

/** Whether this stretch carries any cell the caller said must keep its crossing. */
function carries(stretch: ReadonlySet<string>, required: ReadonlySet<string>): boolean {
  for (const key of stretch) if (required.has(key)) return true
  return false
}

/**
 * The cells of ONE wet stretch that are worth keeping: the straight runs across it that get you to a far bank.
 *
 * Returns an empty set for a stretch that touches one bank or none: it leads from the shore into the water and
 * back to the same shore, which is a paddle rather than a way.
 */
function crossingThrough(
  stretch: ReadonlySet<string>,
  shores: ReadonlyMap<number, string[]>,
  banks: ReadonlyMap<string, number>,
  bounds: RiverBounds,
): Set<string> {
  const keep = new Set<string>()
  const reached = [...shores.keys()]
  if (reached.length < 2) return keep
  // The FIRST bank is the near side. A crossing is kept to each of the others, so a stretch that happens to
  // touch three banks does not silently lose one of them.
  const near = shores.get(reached[0]) as string[]
  for (let i = 1; i < reached.length; i++) {
    const run = straightThrough(stretch, near, reached[i], banks)
    if (run) {
      for (const key of widenAcross(run.cells, run.step, stretch, bounds, CROSSING_ROWS)) keep.add(key)
      continue
    }
    // No straight line joins these two banks on this stretch, so there is no rectangle to put a bridge on.
    // Take the narrow staircase instead and let it read as a ford. Keeping the WHOLE stretch here was the
    // causeway all over again, measured as a 14-wide slab of deck on one seed.
    const ford = shortestThrough(stretch, near, shores.get(reached[i]) as string[])
    // The path plus the water immediately beside it, so it is walkable rather than a tightrope. One pass
    // over the path, four looks per cell, nothing re-scanned.
    for (const key of ford) {
      const { col, row } = toCell(key)
      keep.add(key)
      for (const [dc, dr] of ORTHO) {
        const k = cellKey(col + dc, row + dr)
        if (stretch.has(k)) keep.add(k)
      }
    }
  }
  return keep
}
