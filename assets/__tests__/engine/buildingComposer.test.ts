import { composeBuilding } from '@/engine/buildingComposer'

describe('composeBuilding — Nebulith building architecture spec', () => {
  it('builds the smallest legal house: 8 long × 4 tall (3 body + 1 roof)', () => {
    const b = composeBuilding({ type: 'house', floors: 1 })
    expect(b.length).toBe(8)
    expect(b.height).toBe(4)
    expect(b.cells).toHaveLength(4) // 4 rows (top→bottom)
    expect(b.cells[0]).toHaveLength(8) // 8 cols
  })

  it('adds 3 cells of height per floor, always +1 for the roof', () => {
    expect(composeBuilding({ type: 'house', floors: 2 }).height).toBe(7)
    expect(composeBuilding({ type: 'house', floors: 3 }).height).toBe(10)
  })

  it('enforces the minimums even when smaller values are requested', () => {
    const b = composeBuilding({ type: 'house', floors: 0, length: 3 })
    expect(b.length).toBeGreaterThanOrEqual(8)
    expect(b.height).toBeGreaterThanOrEqual(4)
  })

  it('places a 2×2 door at the bottom, within the facade', () => {
    const b = composeBuilding({ type: 'house', floors: 1 })
    expect(b.door.width).toBe(2)
    expect(b.door.height).toBe(2)
    const bottom = b.height - 1
    // door occupies the bottom two rows at door.x..door.x+1
    expect(b.cells[bottom][b.door.x]).toBe('door')
    expect(b.cells[bottom][b.door.x + 1]).toBe('door')
    expect(b.cells[bottom - 1][b.door.x]).toBe('door')
    expect(b.door.x).toBeGreaterThan(0)
    expect(b.door.x + b.door.width).toBeLessThanOrEqual(b.length)
  })

  it('roofs the top row and walls the rest (corners are walls, not door)', () => {
    const b = composeBuilding({ type: 'house', floors: 1 })
    expect(b.cells[0].every(c => c === 'roof')).toBe(true)
    expect(b.cells[b.height - 1][0]).toBe('wall')
  })

  it('sizes larger structures bigger than a house but still legal', () => {
    const castle = composeBuilding({ type: 'castle' })
    const house = composeBuilding({ type: 'house' })
    expect(castle.length).toBeGreaterThan(house.length)
    expect(castle.height).toBeGreaterThanOrEqual(4)
    expect(castle.door.width).toBeGreaterThanOrEqual(2)
  })
})
