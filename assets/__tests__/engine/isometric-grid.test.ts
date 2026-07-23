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

describe('IsometricGrid — placeAsset carries opacity/brightness (contrast controls)', () => {
  it('round-trips opacity + brightness onto the stored asset', () => {
    const grid = mkGrid()
    grid.placeAsset(['@'], 2, 3, { type: 'tree', color: '#3fa63f', opacity: 0.4, brightness: 1.3 })
    const a = grid.assets.find(x => x.col === 2 && x.row === 3 && x.type !== 'floor')
    expect(a?.opacity).toBe(0.4)
    expect(a?.brightness).toBe(1.3)
  })

  it('leaves opacity/brightness undefined when not given (default = full)', () => {
    const grid = mkGrid()
    grid.placeAsset(['@'], 1, 1, { type: 'tree' })
    const a = grid.assets.find(x => x.col === 1 && x.row === 1 && x.type !== 'floor')
    expect(a?.opacity).toBeUndefined()
    expect(a?.brightness).toBeUndefined()
  })

  it('round-trips authored animation cycles onto the asset', () => {
    const grid = mkGrid()
    const cycles = [
      { id: 'c1', animations: ['flower-sway'], mode: 'sequential' as const, delayMs: 0, trigger: { kind: 'always' as const } },
    ]
    grid.placeAsset(['*'], 4, 4, { type: 'flower', cycles })
    expect(grid.assets.find(a => a.col === 4 && a.row === 4 && a.type !== 'floor')?.cycles).toEqual(cycles)
  })
})
