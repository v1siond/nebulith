import { IsometricGrid } from '@/engine/IsometricGrid'

const mkGrid = () => new IsometricGrid({ cols: 10, rows: 10, cellSize: 16, isoScale: 1.4 })

describe('IsometricGrid — blocks are collision, not elevation', () => {
  it('placeComposite marks blocking cells without raising terrain height', () => {
    const grid = mkGrid()
    grid.placeComposite(
      'house',
      [
        { tile: 'wall', char: '#', dx: 0, dy: 0, height: 2, blocking: true, type: 'building' },
        { tile: 'wall', char: '#', dx: 1, dy: 0, height: 2, blocking: true, type: 'building' },
      ],
      3,
      4,
    )
    // collision IS set (logical block map)
    expect(grid.isBlocked(3, 4)).toBe(true)
    expect(grid.isBlocked(4, 4)).toBe(true)
    // terrain height is NOT raised — blocks are collision, not elevation
    expect(grid.getHeight(3, 4)).toBe(0)
    expect(grid.getHeight(4, 4)).toBe(0)
  })

  it('placeTile sets collision for a blocking asset regardless of its height level', () => {
    const grid = mkGrid()
    grid.placeTile('wall', '#', 2, 2, 3, { blocking: true, type: 'building' }) // heightLevel 3
    expect(grid.isBlocked(2, 2)).toBe(true)
  })

  it('the Height tool (setHeight) still raises deliberate terrain', () => {
    const grid = mkGrid()
    grid.setHeight(5, 5, 3)
    expect(grid.getHeight(5, 5)).toBe(3)
  })
})
