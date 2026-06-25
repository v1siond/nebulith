import { composeBuilding, facadeLabel, facadeLabels } from '@/engine/buildingComposer'
import { isWalkable } from '@/engine/cellLabels'

describe('composeBuilding — Nebulith building architecture spec', () => {
  it('builds the smallest legal house: 4 long × 5 tall (3 body + 2 roof)', () => {
    const b = composeBuilding({ type: 'house', floors: 1 })
    expect(b.length).toBe(4)
    expect(b.height).toBe(5)
    expect(b.cells).toHaveLength(5) // 5 rows (top→bottom)
    expect(b.cells[0]).toHaveLength(4) // 4 cols
  })

  it('adds 3 cells of height per floor, always +2 for the roof', () => {
    expect(composeBuilding({ type: 'house', floors: 2 }).height).toBe(8)
    expect(composeBuilding({ type: 'house', floors: 3 }).height).toBe(11)
  })

  it('peaks the house roof (empty corners → triangle) but keeps store/building roofs flat', () => {
    const house = composeBuilding({ type: 'house', floors: 1 })
    const store = composeBuilding({ type: 'store', floors: 1 })
    expect(house.cells[0].some(c => c === 'empty')).toBe(true) // top row narrows to the apex
    expect(store.cells[0].every(c => c === 'roof')).toBe(true) // flat squared roof, full row
    expect(house.roofTop.y).toBe(0) // apex still the top-centre walkable tile
  })

  it('enforces the minimums even when smaller values are requested', () => {
    const b = composeBuilding({ type: 'house', floors: 0, length: 1 })
    expect(b.length).toBeGreaterThanOrEqual(2)
    expect(b.height).toBeGreaterThanOrEqual(5)
  })

  it('builds a 2-wide cottage (the minimum) — still legal with a door + apex', () => {
    const b = composeBuilding({ type: 'house', floors: 1, length: 2 })
    expect(b.length).toBe(2)
    expect(b.door.width).toBeGreaterThanOrEqual(1)
    expect(b.door.x + b.door.width).toBeLessThanOrEqual(b.length)
    expect(b.roofTop).toEqual({ x: 1, y: 0 })
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

  it('roofs the top row (flat store) and walls the body (corners are walls, not door)', () => {
    const b = composeBuilding({ type: 'store', floors: 1 }) // flat roof → full top row
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

  it('marks the apex (top-center) as the single roofTop cell', () => {
    const b = composeBuilding({ type: 'house', floors: 1 })
    expect(b.roofTop.y).toBe(0) // top row
    expect(b.roofTop.x).toBe(Math.floor(b.length / 2)) // centered
    expect(b.cells[b.roofTop.y][b.roofTop.x]).toBe('roof') // apex is a roof cell
  })
})

describe('facadeLabels — facade-cell → CellLabel mapping (the keystone)', () => {
  it('labels exactly ONE cell roof_top (the walkable apex), all others non-roof_top', () => {
    const b = composeBuilding({ type: 'house', floors: 2 })
    const labels = facadeLabels(b).flat()
    const roofTops = labels.filter(l => l === 'roof_top')
    expect(roofTops).toHaveLength(1)
    expect(facadeLabel(b, b.roofTop.x, b.roofTop.y)).toBe('roof_top')
  })

  it('maps every facade kind to its part label (roof body, wall, door, window)', () => {
    const b = composeBuilding({ type: 'store', floors: 1 }) // flat roof → full top row to check
    const labels = facadeLabels(b)
    // top row: apex is roof_top, the rest of the roof row is plain roof
    for (let col = 0; col < b.length; col++) {
      const expected = col === b.roofTop.x ? 'roof_top' : 'roof'
      expect(labels[0][col]).toBe(expected)
    }
    // door band (bottom rows) carries 'door'; corners of the bottom row are walls
    const bottom = b.height - 1
    expect(labels[bottom][b.door.x]).toBe('door')
    expect(labels[bottom][0]).toBe('wall')
    // a window exists somewhere on a body row
    expect(labels.flat()).toContain('window')
  })

  it('per-label collision: ONLY roof_top + doors are walkable, walls/roof/windows block', () => {
    const b = composeBuilding({ type: 'temple' })
    const labels = facadeLabels(b).flat().filter((l): l is NonNullable<typeof l> => l !== null)
    const walkable = labels.filter(l => isWalkable(l))
    // exactly one roof_top among the walkable cells; the rest are doors
    expect(walkable.filter(l => l === 'roof_top')).toHaveLength(1)
    expect(walkable.every(l => l === 'roof_top' || l === 'door')).toBe(true)
    // walls, roof body, windows all block
    expect(labels.filter(l => l === 'wall').every(l => !isWalkable(l))).toBe(true)
    expect(labels.filter(l => l === 'roof').every(l => !isWalkable(l))).toBe(true)
    expect(labels.filter(l => l === 'window').every(l => !isWalkable(l))).toBe(true)
  })
})

describe('composeBuilding — depth dimension (iso z)', () => {
  it('carries a depth (default 2) + roofRows, independent of floors', () => {
    expect(composeBuilding({ type: 'house', floors: 1 }).depth).toBe(2)
    expect(composeBuilding({ type: 'house', floors: 3 }).depth).toBe(2) // floors don't change depth
    expect(composeBuilding({ type: 'house', depth: 4 }).depth).toBe(4)
    expect(composeBuilding({ type: 'house' }).roofRows).toBe(2)
  })
})
