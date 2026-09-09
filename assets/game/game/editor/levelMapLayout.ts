/**
 * THE LEVEL MAP — levels placed where their doorways say they are.
 *
 * Alexander, 2026-09-08: *"while we do have a connection of all levels, it's not formed into a real map
 * layout"*, and earlier, asking for *"a map of the overall layout of levels"*.
 *
 * What it replaced laid every level on a CIRCLE by its position in the array
 * (`angle = i / count * 2π`). That draws the right edges — you could see what connects to what — but the
 * POSITIONS carried no information at all: the level through your east door might be drawn to the
 * north-west, and reordering the list moved everything. It was a graph diagram, not a map.
 *
 * THE IDEA: a doorway already has a direction. It lives in specific cells of a specific level, so which
 * EDGE of that level it sits nearest is a fact, not a guess. If A's east-edge doorway leads to B, then B
 * belongs east of A. Walk the graph outward from where you are, placing each level one step in the
 * direction its doorway pointed, and the result is a map you can navigate by memory the way you navigate
 * a game world.
 *
 * Pure and lattice-based: this returns integer grid coordinates and knows nothing about pixels or canvas,
 * so it is testable without rendering and the view is free to scale it however it likes.
 */

/** Which edge of its own level a doorway sits on. */
export type Direction = 'north' | 'south' | 'east' | 'west'

/** One step on the lattice, per direction. Screen convention: north is up, so its `y` is negative. */
const STEP: Readonly<Record<Direction, { x: number; y: number }>> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
}

/** A level as the layout needs to see it — no api types, so this stays testable in isolation. */
export interface LevelNode {
  id: string
  name: string
  /** The level's own grid, used to decide which edge a doorway cell is nearest. */
  cols: number
  rows: number
  doors: readonly LevelDoor[]
}

export interface LevelDoor {
  targetId: string
  /** The doorway's cells in the SOURCE level. */
  cells: readonly { col: number; row: number }[]
}

/** Where a level ended up, in lattice steps from the origin level. */
export interface PlacedLevel {
  id: string
  name: string
  gx: number
  gy: number
  /** False when nothing links this level to the one you are standing in — see `layoutLevels`. */
  connected: boolean
}

/**
 * Which edge of a `cols × rows` level a doorway sits nearest.
 *
 * Distance to each of the four edges, smallest wins. A doorway spanning several cells is judged by its
 * CENTRE, so a wide gate in the south wall reads as south rather than as whichever cell came first in the
 * array. Ties break east/west before north/south only because something has to; a doorway equidistant from
 * two edges is genuinely ambiguous and either answer is defensible.
 */
export function doorDirection(door: LevelDoor, cols: number, rows: number): Direction | null {
  if (door.cells.length === 0) return null
  const col = door.cells.reduce((sum, c) => sum + c.col, 0) / door.cells.length
  const row = door.cells.reduce((sum, c) => sum + c.row, 0) / door.cells.length
  const distances: ReadonlyArray<readonly [Direction, number]> = [
    ['west', col],
    ['east', cols - 1 - col],
    ['north', row],
    ['south', rows - 1 - row],
  ]
  return distances.reduce((best, next) => (next[1] < best[1] ? next : best))[0]
}

/**
 * Place every level on a lattice, walking outward from `originId`.
 *
 * Breadth-first, so the levels one door away are placed before the levels two doors away and the shape
 * grows outward from where you actually are.
 *
 * Two cases the naive version gets wrong, both handled here:
 *
 *  · **Two doors pointing the same way.** Two levels cannot occupy one cell. The second spirals out to the
 *    nearest free slot, which keeps it near its true direction without overlapping.
 *  · **Levels with no path to you.** A level that nothing connects to has no spatial relationship to the
 *    rest, and inventing one would be the same lie the circle told. They are placed in a row BELOW the
 *    connected map and flagged `connected: false`, so the view can draw them as an "unreachable" shelf.
 */
export function layoutLevels(nodes: readonly LevelNode[], originId: string): PlacedLevel[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const placed = new Map<string, PlacedLevel>()
  const taken = new Set<string>()
  const slot = (x: number, y: number) => `${x},${y}`

  const origin = byId.get(originId) ?? nodes[0]
  if (!origin) return []

  const put = (node: LevelNode, x: number, y: number, connected: boolean): PlacedLevel => {
    let { gx, gy } = nearestFreeSlot(x, y, taken)
    if (!connected) { gx = x; gy = y } // the unreachable shelf is laid out by the caller's own counter
    taken.add(slot(gx, gy))
    const entry = { id: node.id, name: node.name, gx, gy, connected }
    placed.set(node.id, entry)
    return entry
  }

  put(origin, 0, 0, true)
  const queue: string[] = [origin.id]
  while (queue.length > 0) {
    const id = queue.shift() as string
    const node = byId.get(id)
    const here = placed.get(id)
    if (!node || !here) continue
    for (const door of node.doors) {
      if (placed.has(door.targetId)) continue
      const target = byId.get(door.targetId)
      if (!target) continue // a doorway to a level that no longer exists places nothing
      const dir = doorDirection(door, node.cols, node.rows)
      if (!dir) continue
      put(target, here.gx + STEP[dir].x, here.gy + STEP[dir].y, true)
      queue.push(target.id)
    }
  }

  // Whatever the walk could not reach. Below the map, in a row, in the order given.
  const lowest = [...placed.values()].reduce((max, p) => Math.max(max, p.gy), 0)
  let shelf = 0
  for (const node of nodes) {
    if (placed.has(node.id)) continue
    put(node, shelf++, lowest + 2, false)
  }
  return [...placed.values()]
}

/**
 * The free lattice slot nearest to (x, y) — the wanted slot itself when it is free.
 *
 * An outward ring search, so a displaced level lands as close to its true direction as it can. Bounded by
 * a radius no realistic graph will reach; past it the slot is returned anyway rather than looping forever,
 * because two overlapping nodes are a far smaller problem than a hung editor.
 */
function nearestFreeSlot(x: number, y: number, taken: ReadonlySet<string>): { gx: number; gy: number } {
  const free = (gx: number, gy: number) => !taken.has(`${gx},${gy}`)
  if (free(x, y)) return { gx: x, gy: y }
  for (let radius = 1; radius <= 24; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue // the ring only, not the filled square
        if (free(x + dx, y + dy)) return { gx: x + dx, gy: y + dy }
      }
    }
  }
  return { gx: x, gy: y }
}

/** The lattice's extent, so a view can fit the whole map into its box. */
export function layoutBounds(placed: readonly PlacedLevel[]): { minX: number; maxX: number; minY: number; maxY: number } {
  if (placed.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  return placed.reduce(
    (box, p) => ({
      minX: Math.min(box.minX, p.gx),
      maxX: Math.max(box.maxX, p.gx),
      minY: Math.min(box.minY, p.gy),
      maxY: Math.max(box.maxY, p.gy),
    }),
    { minX: placed[0].gx, maxX: placed[0].gx, minY: placed[0].gy, maxY: placed[0].gy },
  )
}
