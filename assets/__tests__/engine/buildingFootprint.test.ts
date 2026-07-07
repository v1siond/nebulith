import { buildingFootprint } from '@/engine/buildingFootprint'

describe('buildingFootprint — a building as ground-plan TILES (perimeter wall / interior floor / door)', () => {
  test('3×3, 2 floors: 8 perimeter (7 wall + 1 front-centre door) + 1 interior floor', () => {
    const cells = buildingFootprint(3, 3, 2)
    expect(cells).toHaveLength(9)
    const walls = cells.filter(c => c.kind === 'wall')
    const floors = cells.filter(c => c.kind === 'floor')
    const doors = cells.filter(c => c.kind === 'door')
    expect(walls).toHaveLength(7)
    expect(floors).toHaveLength(1)
    expect(doors).toHaveLength(1)
    expect(floors[0]).toMatchObject({ dx: 1, dy: 1, height: 0 })
    expect(doors[0]).toMatchObject({ dx: 1, dy: 2, height: 0 }) // front (max dy) centre
  })

  test('wall height = floors; floor/door are flat (height 0)', () => {
    const cells = buildingFootprint(4, 4, 3)
    expect(cells.filter(c => c.kind === 'wall').every(c => c.height === 3)).toBe(true)
    expect(cells.filter(c => c.kind !== 'wall').every(c => c.height === 0)).toBe(true)
  })

  test('floors clamps to at least 1', () => {
    expect(buildingFootprint(3, 3, 0).find(c => c.kind === 'wall')!.height).toBe(1)
  })

  test('too small for a door (<3 wide) → no door, all perimeter is wall', () => {
    const cells = buildingFootprint(2, 2, 1)
    expect(cells.some(c => c.kind === 'door')).toBe(false)
    expect(cells.every(c => c.kind === 'wall')).toBe(true) // 2×2 = all perimeter
  })
})
