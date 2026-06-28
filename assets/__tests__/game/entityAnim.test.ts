import { entityAnimState, entityFrameIndex } from '../../engine/entityAnim'

describe('entityAnimState', () => {
  test('moving enemy not in range → walk', () => {
    expect(entityAnimState({ moving: true, inRange: false, kind: 'enemy' })).toBe('walk')
  })
  test('still entity → idle', () => {
    expect(entityAnimState({ moving: false, inRange: false, kind: 'enemy' })).toBe('idle')
  })
  test('enemy in range → combat (even if moving)', () => {
    expect(entityAnimState({ moving: true, inRange: true, kind: 'enemy' })).toBe('combat')
  })
  test('non-enemy never enters combat', () => {
    expect(entityAnimState({ moving: false, inRange: true, kind: 'npc' })).toBe('idle')
  })
})

describe('entityFrameIndex', () => {
  test('idle does NOT advance frames over time (no leg/arm swap)', () => {
    const a = entityFrameIndex('idle', 0, 2)
    const b = entityFrameIndex('idle', 5000, 2)
    expect(a).toBe(b)
  })
  test('walk advances frames over time (period-robust: produces >1 distinct frame)', () => {
    // Sample across time; a swapping walk must show BOTH frames regardless of the exact period
    // (asserting a single hardcoded time is fragile — it can alias on the frame period).
    const seen = new Set<number>()
    for (let t = 0; t <= 4000; t += 60) seen.add(entityFrameIndex('walk', t, 2))
    expect(seen.size).toBeGreaterThan(1)
  })
  test('frame index always within range', () => {
    for (const t of [0, 123, 999, 360, 720]) {
      const i = entityFrameIndex('walk', t, 2)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(2)
    }
  })
})
