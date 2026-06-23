import {
  buildBoxPatrol,
  appendWaypoint,
  setMovementMode,
  clearWaypoints,
  buildStepList,
  addMovementStep,
  removeMovementStep,
  updateMovementStep,
  setStepDelay,
  makeAttackPattern,
  defaultAttackPattern,
  MIN_ATTACK_COOLDOWN_MS,
} from '@/game/patterns'

describe('movement patterns', () => {
  it('buildBoxPatrol makes a 4-corner loop around the origin', () => {
    const p = buildBoxPatrol(5, 5, 'sequential', 2)
    expect(p.mode).toBe('sequential')
    expect(p.waypoints).toEqual([
      { col: 5, row: 5 },
      { col: 7, row: 5 },
      { col: 7, row: 7 },
      { col: 5, row: 7 },
    ])
  })

  it('appendWaypoint creates a pattern when none exists and appends to it', () => {
    const a = appendWaypoint(undefined, { col: 1, row: 2 }, 'random')
    expect(a).toEqual({ mode: 'random', waypoints: [{ col: 1, row: 2 }] })
    const b = appendWaypoint(a, { col: 3, row: 4 })
    expect(b.waypoints).toEqual([{ col: 1, row: 2 }, { col: 3, row: 4 }])
    expect(b.mode).toBe('random') // mode preserved
  })

  it('appendWaypoint ignores an immediate duplicate of the last waypoint', () => {
    const a = appendWaypoint(undefined, { col: 1, row: 1 })
    const b = appendWaypoint(a, { col: 1, row: 1 })
    expect(b.waypoints).toHaveLength(1)
  })

  it('appendWaypoint does not mutate the input pattern', () => {
    const a = { mode: 'sequential' as const, waypoints: [{ col: 0, row: 0 }] }
    appendWaypoint(a, { col: 9, row: 9 })
    expect(a.waypoints).toHaveLength(1)
  })

  it('setMovementMode flips the mode but keeps the waypoints', () => {
    const a = buildBoxPatrol(0, 0, 'sequential')
    const b = setMovementMode(a, 'random')
    expect(b.mode).toBe('random')
    expect(b.waypoints).toEqual(a.waypoints)
  })

  it('clearWaypoints empties the path but keeps the mode', () => {
    const a = buildBoxPatrol(0, 0, 'random')
    const b = clearWaypoints(a)
    expect(b.mode).toBe('random')
    expect(b.waypoints).toEqual([])
  })
})

describe('attack patterns', () => {
  it('makeAttackPattern clamps the cooldown to the floor and rounds to whole ms', () => {
    expect(makeAttackPattern('melee', 50).cooldownMs).toBe(MIN_ATTACK_COOLDOWN_MS)
    expect(makeAttackPattern('ranged', 1200.7).cooldownMs).toBe(1201)
    expect(makeAttackPattern('ranged', 1200.7).mode).toBe('ranged')
  })

  it('defaultAttackPattern gives ranged a slower swing than melee', () => {
    expect(defaultAttackPattern('melee').cooldownMs).toBeLessThan(
      defaultAttackPattern('ranged').cooldownMs,
    )
    expect(defaultAttackPattern().mode).toBe('melee')
  })
})

describe('step-list movement helpers', () => {
  it('buildStepList seeds a 4-direction run list with the given mode', () => {
    const p = buildStepList('random')
    expect(p.mode).toBe('random')
    expect(p.steps?.map(s => s.dir)).toEqual(['right', 'left', 'up', 'down'])
    expect(p.steps?.every(s => s.cells === 5)).toBe(true)
  })

  it('setMovementMode PRESERVES the steps (regression: it used to drop them)', () => {
    const p = buildStepList('sequential')
    const flipped = setMovementMode(p, 'random')
    expect(flipped.mode).toBe('random')
    expect(flipped.steps).toEqual(p.steps)
  })

  it('add / remove / update steps immutably; cells clamp to ≥1', () => {
    const p = buildStepList('sequential')
    const added = addMovementStep(p, { dir: 'up', cells: 2 })
    expect(added.steps).toHaveLength(5)
    expect(p.steps).toHaveLength(4) // original untouched

    const removed = removeMovementStep(added, 0)
    expect(removed.steps).toHaveLength(4)
    expect(removed.steps?.[0].dir).toBe('left') // first dropped

    const clamped = updateMovementStep(p, 0, { cells: 0 })
    expect(clamped.steps?.[0].cells).toBe(1) // clamped up to a minimum of 1
  })

  it('setStepDelay clamps to a whole non-negative number', () => {
    expect(setStepDelay(buildStepList('random'), -50).delayMs).toBe(0)
    expect(setStepDelay(buildStepList('random'), 1234.7).delayMs).toBe(1235)
  })
})
