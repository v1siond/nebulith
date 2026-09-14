/**
 * PATHS FIRST. and for a cave,
 *
 * So these pin the two numbers against each other: a gate per exit, and every pathway the exits do not account for
 * ending somewhere inside the map instead of at its border.
 */
import { DEAD_END_MARGIN, planRoutes, resolveCount, resolveWays, ROUTE_COUNTS, type RouteCount, type RoutePlan } from '@/engine/pathNetwork'
import { makeRng } from '@/lib/math'

const COLS = 40
const ROWS = 30
const ways = (exits: RouteCount, pathways: RouteCount) => ({ exits, pathways })
const EVERY: Array<[RouteCount, RouteCount]> = ROUTE_COUNTS.flatMap(e => ROUTE_COUNTS.map(p => [e, p] as [RouteCount, RouteCount]))
const key = (c: { col: number; row: number }) => `${c.col},${c.row}`

/** Every cell reachable along the network from the entrance, stepping orthogonally. */
function reach(plan: RoutePlan): Set<string> {
  const seen = new Set<string>()
  const stack = plan.entrance.cells.map(key)
  stack.forEach(k => seen.add(k))
  while (stack.length) {
    const [c, r] = stack.pop()!.split(',').map(Number)
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${c + dc},${r + dr}`
      if (plan.cells.has(k) && !seen.has(k)) { seen.add(k); stack.push(k) }
    }
  }
  return seen
}

describe('a map has one gate per exit, and the first is the way in', () => {
  it.each(EVERY)('%i exits, %i pathways', (exits, pathways) => {
    for (let seed = 1; seed <= 20; seed++) {
      const plan = planRoutes(COLS, ROWS, ways(exits, pathways), makeRng(seed))
      expect(plan.gates).toHaveLength(exits)
      expect(plan.entrance).toBe(plan.gates[0])
      expect(plan.entrance.side).toBe('south')
      const sides = plan.gates.map(g => g.side)
      expect(new Set(sides).size).toBe(sides.length) // one gate per edge, never two on the same side
      expect(sides.filter(s => s === 'south')).toHaveLength(1)
    }
  })

  it('every gate sits on its own edge, three cells wide, and is part of the network', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const plan = planRoutes(COLS, ROWS, ways(4, 4), makeRng(seed))
      for (const gate of plan.gates) {
        expect(gate.cells).toHaveLength(3)
        for (const c of gate.cells) {
          const onEdge = { south: c.row === ROWS - 1, north: c.row === 0, west: c.col === 0, east: c.col === COLS - 1 }[gate.side]
          expect(onEdge).toBe(true)
          expect(plan.cells.has(key(c))).toBe(true)
        }
      }
    }
  })
})

describe('a pathway that is not an exit stops inside the map', () => {
  it.each(EVERY)('%i exits, %i pathways', (exits, pathways) => {
    for (let seed = 1; seed <= 20; seed++) {
      const plan = planRoutes(COLS, ROWS, ways(exits, pathways), makeRng(seed))
      expect(plan.deadEnds).toHaveLength(Math.max(0, pathways - exits))
      for (const stop of plan.deadEnds) {
        // never near the border: a dead end must not read as a way out that failed to open
        expect(Math.min(stop.col, stop.row, COLS - 1 - stop.col, ROWS - 1 - stop.row)).toBeGreaterThanOrEqual(DEAD_END_MARGIN)
        expect(plan.cells.has(key(stop))).toBe(true)
      }
    }
  })

  it('his cave: 1 exit and 3 pathways is one way back out and two branches that stop', () => {
    const cave = planRoutes(COLS, ROWS, ways(1, 3), makeRng(9))
    expect(cave.gates).toHaveLength(1)
    expect(cave.deadEnds).toHaveLength(2)
    // and the end of the cave: one exit, no pathway, nothing but the way you came in
    const end = planRoutes(COLS, ROWS, ways(1, 1), makeRng(9))
    expect(end.gates).toHaveLength(1)
    expect(end.deadEnds).toEqual([])
  })

  it('the stops are apart from each other, not three branches into the same corner', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const plan = planRoutes(COLS, ROWS, ways(1, 4), makeRng(seed))
      const [a, b, c] = plan.deadEnds
      for (const [p, q] of [[a, b], [a, c], [b, c]]) {
        expect(Math.hypot(p.col - q.col, p.row - q.row)).toBeGreaterThan(3)
      }
    }
  })
})

describe('the network holds together', () => {
  it.each(EVERY)('%i exits, %i pathways: from the entrance you reach the hub, every gate and every stop', (exits, pathways) => {
    for (let seed = 1; seed <= 20; seed++) {
      const plan = planRoutes(COLS, ROWS, ways(exits, pathways), makeRng(seed))
      const walked = reach(plan)
      expect(walked.has(key(plan.hub))).toBe(true)
      for (const gate of plan.gates) expect(gate.cells.every(c => walked.has(key(c)))).toBe(true)
      for (const stop of plan.deadEnds) expect(walked.has(key(stop))).toBe(true)
    }
  })

  it('the paths bend: they are not one straight line from the entrance to the hub', () => {
    let bent = 0
    for (let seed = 1; seed <= 40; seed++) {
      const plan = planRoutes(COLS, ROWS, ways(1, 1), makeRng(seed))
      const cols = new Set([...plan.cells].map(k => Number(k.split(',')[0])))
      if (cols.size > 3) bent++
    }
    expect(bent).toBeGreaterThan(30)
  })

  it('stays inside the map', () => {
    const plan = planRoutes(COLS, ROWS, ways(4, 4), makeRng(7))
    for (const k of plan.cells) {
      const [c, r] = k.split(',').map(Number)
      expect(c >= 0 && r >= 0 && c < COLS && r < ROWS).toBe(true)
    }
  })
})

describe('the two served counts', () => {
  it('a named count is kept, and a recipe that states neither keeps its old map', () => {
    expect(resolveCount('3', makeRng(1))).toBe(3)
    expect(resolveCount(undefined, makeRng(1))).toBeNull()
    expect(resolveCount('none', makeRng(1))).toBeNull()
    expect(resolveWays(undefined, makeRng(1))).toBeNull()
    expect(resolveWays({ river: 'through' }, makeRng(1))).toBeNull()
  })

  it('one count given, the other follows it', () => {
    // exits alone: every path is a way out. pathways alone: one way out, the rest stop inside.
    // TWO EXITS IS ONE ROAD STRAIGHT THROUGH, not two roads. This expected two pathways,
    // which is the old count-from-the-centre-out model he corrected.
    expect(resolveWays({ exits: '2' }, makeRng(1))).toEqual({ exits: 2, pathways: 1 })
    // …and pathways alone now INFER their exits, which he asked for directly: Three stretches want six
    // exits and a map has four sides, so four. It used to default to one, which made two of the three
    // stretches dead ends on a map that had asked for roads.
    expect(resolveWays({ pathways: '3' }, makeRng(1))).toEqual({ exits: 4, pathways: 3 })
  })

  it('random picks every count across maps', () => {
    const seen = new Set<number>()
    for (let seed = 1; seed <= 60; seed++) seen.add(resolveCount('random', makeRng(seed))!)
    expect([...seen].sort()).toEqual([...ROUTE_COUNTS])
  })
})

describe('the spine: the one-cell centre line of the same network', () => {
  // A cave gallery has to pinch and open along its run, and narrowing a corridor by hand is how a leg gets
  // severed by accident. The spine is carved ALWAYS, so the width above it is free to vary.
  it.each(EVERY)('%i exits, %i pathways: the spine is inside the band, and holds the whole map together', (exits, pathways) => {
    for (let seed = 1; seed <= 10; seed++) {
      const plan = planRoutes(COLS, ROWS, ways(exits, pathways), makeRng(seed))
      for (const k of plan.spine) expect(plan.cells.has(k)).toBe(true)

      // walk the SPINE only: the hub, every gate and every stop must still be reachable from the entrance
      const seen = new Set<string>()
      const start = [...plan.spine].filter(k => plan.entrance.cells.some(c => key(c) === k))
      expect(start.length).toBeGreaterThan(0)
      const stack = [...start]
      start.forEach(k => seen.add(k))
      while (stack.length) {
        const [c, r] = stack.pop()!.split(',').map(Number)
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${c + dc},${r + dr}`
          if (plan.spine.has(k) && !seen.has(k)) { seen.add(k); stack.push(k) }
        }
      }
      expect(seen.has(key(plan.hub))).toBe(true)
      for (const gate of plan.gates) expect(gate.cells.some(c => seen.has(key(c)))).toBe(true)
      for (const stop of plan.deadEnds) expect(seen.has(key(stop))).toBe(true)
    }
  })

  it('is a fraction of the band, not the whole of it', () => {
    const plan = planRoutes(COLS, ROWS, ways(3, 4), makeRng(5))
    expect(plan.spine.size).toBeGreaterThan(0)
    expect(plan.spine.size).toBeLessThan(plan.cells.size / 2) // a 3-wide band is about three times its centre
  })
})
