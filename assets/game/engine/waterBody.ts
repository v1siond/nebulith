/**
 * A BODY OF WATER, and the border tiles around its edge.
 *
 * The model, from `docs/WATER.md` §1: water is TERRAIN. A river, a lake and a beach are the same thing, a
 * set of cells painted with a water tile, and what makes each of them read as what it is comes from the
 * SHAPE that is painted plus a border around its edge. There is no channel, no carve, no depth band and no
 * subsystem: a body of water is a set of coordinates.
 *
 * So all this module does is the edge pass. Every cell whose orthogonal neighbour is not part of the same
 * body is a boundary cell, and which of the nine pieces it wears comes from WHICH of its sides face out.
 * The border colour lives inside the edge pieces' own art, so nothing here paints a colour.
 *
 * The autotile arithmetic is `cellLabels.autotileLabel`, which is exhaustive over all sixteen orthogonal
 * signatures and already carries the tree masses and the building footprints. Adding water is adding a
 * FAMILY, which is what that module asks callers to do instead of branching.
 */
import { autotileLabel, type MassFamily } from './cellLabels'

/** The water sets the catalog carries. A set is a LOOK: the same set paints a mountain tarn and a harbour. */
export type WaterSet = 'smooth' | 'lined'

export const WATER_SETS: readonly WaterSet[] = ['smooth', 'lined']

export const DEFAULT_WATER_SET: WaterSet = 'smooth'

/**
 * A LIQUID is what the map's channels are filled with. Water in two looks, or lava.
 *
 * *"the lava river shouldn't be the default for volcanic, just another option on water, we can call water
 * liquids or something"*. So lava is a CHOICE anyone can make on any map, not a property of being volcanic,
 * and a volcano keeps its river unless somebody asks for magma.
 *
 * And lava needs no art of its own: *"we also must do lava, which is basically water colored as lava"*. It
 * wears the smooth family's pieces, including its border pieces, and differs in two things that actually
 * matter: the colour, and the fact that you cannot wade it.
 */
export type Liquid = 'smooth' | 'lined' | 'lava'

export const LIQUIDS: readonly Liquid[] = ['smooth', 'lined', 'lava']

export const DEFAULT_LIQUID: Liquid = 'smooth'

/** Which piece family a liquid draws with. Lava borrows the smooth one; its own look is its colour. */
export const setForLiquid = (liquid: Liquid): WaterSet => (liquid === 'lava' ? 'smooth' : liquid)

/** Molten liquid is never wadeable, whatever its depth. A shallow edge of lava is still lava. */
export const isMolten = (liquid: Liquid): boolean => liquid === 'lava'

/**
 * WHAT KIND OF BODY this is, which decides what its EDGE looks like. His words:
 *
 *   "is not the same a lake or a river than a beach, a [river] should have white borders due to the current,
 *    lake should be more darker because it doesn't have current, and beach should be a mix, to simulate the
 *    effect of beach waves getting to the sand"
 *
 * So the rim is bright on a river (the current throwing up white water), dark on a lake (still water going
 * deep at the edge), and both on a beach (a wave reaching sand). It is a property of the BODY, not of the
 * set, which is why a set and a kind are two different axes.
 */
export type WaterKind = 'river' | 'lake' | 'beach'

export const WATER_KINDS: readonly WaterKind[] = ['river', 'lake', 'beach']

/** Built once per set and kind rather than per cell: the pass runs over every water cell on the map. */
const FAMILIES: Readonly<Record<string, MassFamily<string>>> = Object.fromEntries(
  WATER_SETS.flatMap(set => WATER_KINDS.map(kind => [`${set}/${kind}`, family(set, kind)])),
)

function family(set: WaterSet, kind: WaterKind): MassFamily<string> {
  const piece = (suffix: string): string => `water_${set}_${kind}_${suffix}`
  return {
    topLeft: piece('tl'), top: piece('t'), topRight: piece('tr'),
    edgeLeft: piece('l'), interior: piece('c'), edgeRight: piece('r'),
    bottomLeft: piece('bl'), bottom: piece('b'), bottomRight: piece('br'),
  }
}

/** Every label any family can produce, for the tests and for anything that needs to recognise water art. */
export const WATER_SET_LABELS: ReadonlySet<string> = new Set(
  Object.values(FAMILIES).flatMap(f => Object.values(f)),
)

export const isWaterSetLabel = (label: string | undefined): boolean => !!label && WATER_SET_LABELS.has(label)

/** The set a piece belongs to, or null for a label that is not one of ours. */
export function waterSetOf(label: string | undefined): WaterSet | null {
  if (!label) return null
  for (const set of WATER_SETS) if (label.startsWith(`water_${set}_`)) return set
  return null
}

/**
 * WHICH KIND OF BODY a set of cells is, read off what the map already knows rather than asked for.
 *
 *   beach  it meets the map edge along a real stretch, so it is open water running off the map
 *   river  its cells carry a flow direction, so something is moving through it
 *   lake   neither, standing water with no current
 *
 * `flow` is written by the river pass for channel cells only, which is the same distinction the depth pass
 * already draws between a channel and a pool. Nothing new is invented here.
 */
export function classifyBody(cells: Cells, flow: ReadonlyMap<string, number>, cols: number, rows: number): WaterKind {
  let onEdge = 0
  let flowing = 0
  for (const cell of cells) {
    const [col, row] = cell.split(',').map(Number)
    if (col === 0 || row === 0 || col === cols - 1 || row === rows - 1) onEdge += 1
    if (flow.has(cell)) flowing += 1
  }
  // A river crosses the map, so it touches the edge at its two ends and no more. A shore runs ALONG an edge,
  // so a large share of it is edge cells. The threshold is what separates the two shapes.
  if (onEdge >= Math.max(6, cells.size * 0.25)) return 'beach'
  if (flowing > 0) return 'river'
  return 'lake'
}

/** The separate BODIES on a map: water cells that touch each other orthogonally are one body. Two bodies get
 *  classified, and edged, independently, which is how a map can carry a river and a pool at once. */
export function waterBodies(cells: Cells): Cells[] {
  const seen = new Set<string>()
  const bodies: Cells[] = []
  for (const start of cells) {
    if (seen.has(start)) continue
    const body = new Set<string>()
    const queue = [start]
    seen.add(start)
    while (queue.length) {
      const cell = queue.pop() as string
      body.add(cell)
      const [col, row] = cell.split(',').map(Number)
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const next = key(col + dc, row + dr)
        if (!cells.has(next) || seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    bodies.push(body)
  }
  return bodies
}

type Cells = ReadonlySet<string>

const key = (col: number, row: number): string => `${col},${row}`

/**
 * The piece each cell of a body should wear. Pure: it answers a map and writes nothing, so the same
 * arithmetic can be measured in a test and applied by a generator without either one owning the other.
 *
 * `cells` is the whole body. A cell outside it is land as far as this pass is concerned, which is what makes
 * the border land on the boundary whatever shape was painted. Two bodies that touch are ONE body to this
 * function, which is correct: water meeting water has no shore between it.
 */
export function waterPieces(cells: Cells, set: WaterSet = DEFAULT_WATER_SET, kind: WaterKind = 'river'): Map<string, string> {
  const fam = FAMILIES[`${set}/${kind}`]
  const filled = (col: number, row: number): boolean => cells.has(key(col, row))
  const pieces = new Map<string, string>()
  for (const cell of cells) {
    const [col, row] = cell.split(',').map(Number)
    pieces.set(cell, autotileLabel(fam, filled, col, row))
  }
  return pieces
}

/** Just the boundary, which is the record of edge coordinates the border pass is built on. A cell is on the
 *  border when any of its four orthogonal neighbours is not water. */
export function waterEdges(cells: Cells): Set<string> {
  const edges = new Set<string>()
  for (const cell of cells) {
    const [col, row] = cell.split(',').map(Number)
    const open = !cells.has(key(col, row - 1)) || !cells.has(key(col + 1, row)) ||
      !cells.has(key(col, row + 1)) || !cells.has(key(col - 1, row))
    if (open) edges.add(cell)
  }
  return edges
}

type Ground = string[][]

/**
 * Paint a body of water into the ground grid. Returns how many cells were written, so a caller can assert it
 * did something rather than hoping.
 *
 * This is the whole of "draw a lake": hand it the cells of the shape and the set to wear.
 */
export function paintWaterBody(ground: Ground, cells: Cells, set: WaterSet = DEFAULT_WATER_SET, kind: WaterKind = 'river'): number {
  let painted = 0
  for (const [cell, label] of waterPieces(cells, set, kind)) {
    const [col, row] = cell.split(',').map(Number)
    if (!ground[row] || ground[row][col] === undefined) continue
    ground[row][col] = label
    painted += 1
  }
  return painted
}
