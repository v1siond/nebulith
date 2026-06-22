import { stepMover, initMover, type MovementPattern } from '@/engine/movement'

const open = () => false // nothing blocked

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
