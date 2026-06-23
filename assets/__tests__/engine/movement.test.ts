import {
  stepMover,
  initMover,
  initRunState,
  stepRunPatrol,
  type MovementPattern,
} from '@/engine/movement'

const open = () => false // nothing blocked

/** An rng that yields a fixed sequence (then repeats the last value). */
const seqRng = (...vals: number[]) => {
  let i = 0
  return () => vals[Math.min(i++, vals.length - 1)]
}

describe('movement — run-patrol (move, delay, move)', () => {
  const opts = { delayTicks: 2 }

  it('horizontal: runs out N cells, pauses, then reverses back (1234-wait-4321)', () => {
    const pattern: MovementPattern = { mode: 'sequential', waypoints: [], axis: 'horizontal', runLength: 3 }
    let pos = { col: 0, row: 0 }
    let state = initRunState(pattern)
    const step = () => ({ pos, state } = stepRunPatrol(pos, pattern, state, open, opts))
    step(); expect(pos).toEqual({ col: 1, row: 0 })
    step(); expect(pos).toEqual({ col: 2, row: 0 })
    step(); expect(pos).toEqual({ col: 3, row: 0 }) // run done → pausing
    step(); expect(pos).toEqual({ col: 3, row: 0 }) // pause tick (no move)
    step(); expect(pos).toEqual({ col: 2, row: 0 }) // pause over → reversed
    step(); expect(pos).toEqual({ col: 1, row: 0 })
  })

  it('vertical: only up/down runs', () => {
    const pattern: MovementPattern = { mode: 'sequential', waypoints: [], axis: 'vertical', runLength: 2 }
    let pos = { col: 5, row: 5 }
    let state = initRunState(pattern)
    const step = () => ({ pos, state } = stepRunPatrol(pos, pattern, state, open, opts))
    step(); expect(pos).toEqual({ col: 5, row: 6 }) // down
    step(); expect(pos).toEqual({ col: 5, row: 7 }) // run done
    step() // pausing
    step(); expect(pos).toEqual({ col: 5, row: 6 }) // reversed → up; col never changes
    expect(state.dc).toBe(0)
  })

  it('mixed: after a run it picks an axis — vertical randomizes up/down', () => {
    const pattern: MovementPattern = { mode: 'sequential', waypoints: [], axis: 'mixed', runLength: 1 }
    let pos = { col: 5, row: 5 }
    let state = initRunState(pattern) // starts moving right
    // rng: pick vertical (<0.5), then up (<0.5)
    const opts2 = { delayTicks: 1, rng: seqRng(0.1, 0.1) }
    const step = () => ({ pos, state } = stepRunPatrol(pos, pattern, state, open, opts2))
    step(); expect(pos).toEqual({ col: 6, row: 5 }) // ran right (1 cell) → pause
    step() // pause over → choose vertical/up, step
    expect(pos).toEqual({ col: 6, row: 4 }) // moved UP, col unchanged
  })

  it('a wall ends the run early, then it turns', () => {
    const pattern: MovementPattern = { mode: 'sequential', waypoints: [], axis: 'horizontal', runLength: 9 }
    const wall = (c: number) => c >= 2 // block col 2+
    let pos = { col: 0, row: 0 }
    let state = initRunState(pattern)
    const step = () => ({ pos, state } = stepRunPatrol(pos, pattern, state, wall, opts))
    step(); expect(pos).toEqual({ col: 1, row: 0 })
    step(); expect(pos).toEqual({ col: 1, row: 0 }) // blocked → run ends, pausing
    expect(state.waitLeft).toBeGreaterThan(0)
  })
})

describe('movement — sequential patrol along waypoints', () => {
  const pattern: MovementPattern = { mode: 'sequential', waypoints: [{ col: 1, row: 1 }, { col: 4, row: 1 }] }

  it('steps ONE cell per tick toward the current waypoint', () => {
    let pos = { col: 1, row: 1 }
    let state = initMover() // target = waypoint index 1
    ;({ pos, state } = stepMover(pos, pattern, state, open))
    expect(pos).toEqual({ col: 2, row: 1 })
    ;({ pos, state } = stepMover(pos, pattern, state, open))
    expect(pos).toEqual({ col: 3, row: 1 })
  })

  it('loops back to the first waypoint after reaching the last', () => {
    let pos = { col: 3, row: 1 }
    let state = initMover()
    ;({ pos, state } = stepMover(pos, pattern, state, open)) // → (4,1), arrived at wp[1]
    expect(pos).toEqual({ col: 4, row: 1 })
    // now heads back toward wp[0]=(1,1)
    ;({ pos } = stepMover(pos, pattern, state, open))
    expect(pos).toEqual({ col: 3, row: 1 })
  })

  it('stays put when the next cell is blocked (never walks through walls)', () => {
    const blockAt2 = (c: number, r: number) => c === 2 && r === 1
    const { pos } = stepMover({ col: 1, row: 1 }, pattern, initMover(), blockAt2)
    expect(pos).toEqual({ col: 1, row: 1 })
  })
})

describe('movement — random mode', () => {
  it('picks the next waypoint via the injected chooser on arrival', () => {
    const pattern: MovementPattern = {
      mode: 'random',
      waypoints: [{ col: 0, row: 0 }, { col: 0, row: 1 }, { col: 0, row: 2 }],
    }
    // start AT waypoint 0 so it must immediately choose a new target
    const chooseTo2 = () => 2
    const { state } = stepMover({ col: 0, row: 0 }, pattern, { target: 0, dir: 1 }, open, chooseTo2)
    expect(state.target).toBe(2)
  })
})

describe('movement — degenerate patterns', () => {
  it('never moves with zero or one waypoint', () => {
    const none: MovementPattern = { mode: 'sequential', waypoints: [] }
    expect(stepMover({ col: 5, row: 5 }, none, initMover(), open).pos).toEqual({ col: 5, row: 5 })
    const one: MovementPattern = { mode: 'sequential', waypoints: [{ col: 5, row: 5 }] }
    expect(stepMover({ col: 5, row: 5 }, one, initMover(), open).pos).toEqual({ col: 5, row: 5 })
  })
})
