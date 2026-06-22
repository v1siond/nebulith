import { shouldFire, lampPulse } from '@/engine/behaviors'

describe('behaviors — periodic firing (cannon)', () => {
  it('fires only once the interval has elapsed since the last shot', () => {
    expect(shouldFire(1000, 0, 999)).toBe(false)
    expect(shouldFire(1000, 0, 1000)).toBe(true)
    expect(shouldFire(1000, 5000, 5400)).toBe(false)
    expect(shouldFire(1000, 5000, 6000)).toBe(true)
  })

  it('always allows the first shot (lastFiredAt 0, now past interval)', () => {
    expect(shouldFire(500, 0, 500)).toBe(true)
  })
})

describe('behaviors — lamp pulse', () => {
  it('stays within 0..1 across the cycle', () => {
    for (const t of [0, 300, 600, 900, 1200, 5000]) {
      const v = lampPulse(t)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('varies over time (it animates)', () => {
    expect(lampPulse(0)).not.toBeCloseTo(lampPulse(300), 2)
  })
})
