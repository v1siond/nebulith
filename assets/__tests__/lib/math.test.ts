import { lerp, clamp, randInt, randIntWith, chebyshev, manhattan } from '@/lib/math'

describe('lerp', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(lerp(2, 10, 0)).toBe(2)
    expect(lerp(2, 10, 1)).toBe(10)
  })
  it('interpolates linearly in between (incl. past the ends)', () => {
    expect(lerp(0, 10, 0.5)).toBe(5)
    expect(lerp(-4, 4, 0.25)).toBe(-2)
    expect(lerp(0, 10, 2)).toBe(20) // not clamped
  })
})

describe('clamp', () => {
  it('passes values already inside the range through', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })
  it('clamps to the bounds (inclusive)', () => {
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })
})

describe('randIntWith', () => {
  it('maps the rng draw onto the inclusive range', () => {
    expect(randIntWith(() => 0, 3, 7)).toBe(3) // floor(0 * 5) = 0 → lo
    expect(randIntWith(() => 0.99, 3, 7)).toBe(7) // floor(0.99 * 5) = 4 → hi
    expect(randIntWith(() => 0.5, 0, 9)).toBe(5) // floor(0.5 * 10) = 5
  })
  it('only ever returns integers within [lo, hi]', () => {
    let n = 0
    const rng = (): number => (n++ % 100) / 100
    for (let i = 0; i < 100; i++) {
      const v = randIntWith(rng, 2, 8)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(2)
      expect(v).toBeLessThanOrEqual(8)
    }
  })
})

describe('randInt', () => {
  it('uses Math.random and stays within the inclusive range', () => {
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(randInt(0, 9)).toBe(5)
    spy.mockReturnValue(0)
    expect(randInt(4, 6)).toBe(4)
    spy.mockReturnValue(0.999999)
    expect(randInt(4, 6)).toBe(6)
    spy.mockRestore()
  })
})

describe('chebyshev', () => {
  it('is the 8-neighbour (chessboard) distance', () => {
    expect(chebyshev({ col: 0, row: 0 }, { col: 0, row: 0 })).toBe(0)
    expect(chebyshev({ col: 0, row: 0 }, { col: 1, row: 1 })).toBe(1) // diagonal adjacent
    expect(chebyshev({ col: 0, row: 0 }, { col: 3, row: 1 })).toBe(3)
    expect(chebyshev({ col: 5, row: 2 }, { col: 1, row: 5 })).toBe(4)
  })
})

describe('manhattan', () => {
  it('is the 4-neighbour (taxicab) distance', () => {
    expect(manhattan({ col: 0, row: 0 }, { col: 0, row: 0 })).toBe(0)
    expect(manhattan({ col: 0, row: 0 }, { col: 1, row: 1 })).toBe(2)
    expect(manhattan({ col: 0, row: 0 }, { col: 3, row: 1 })).toBe(4)
    expect(manhattan({ col: 5, row: 2 }, { col: 1, row: 5 })).toBe(7)
  })
})
