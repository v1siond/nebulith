import { IsometricGrid } from '@/engine/IsometricGrid'
import { syncTilesetPropCollision } from '@/engine/tilesetCollision'

// The town fountain is a 3×3 basin in ASCII but a single ⛲ cell in emoji. Collision must follow the
// tileset: emoji blocks only the fountain's own cell, ASCII blocks the whole basin.
function gridWithFountain(): IsometricGrid {
  const grid = new IsometricGrid({ cols: 20, rows: 20, cellSize: 16 })
  // fountain prop at the basin CENTRE (10,10), footprint 3 → basin cols/rows [9..11]
  grid.assets.push({ art: ['⊙'], col: 10, row: 10, type: 'fountain', footprint: 3, blocking: true })
  // stage baked the ASCII basin collision
  for (let r = 9; r <= 11; r++) for (let c = 9; c <= 11; c++) grid.setCollision(c, r, true)
  return grid
}

describe('syncTilesetPropCollision — fountain collision follows the tileset', () => {
  test('emoji: only the fountain cell blocks, the rest of the basin is walkable', () => {
    const grid = gridWithFountain()
    syncTilesetPropCollision(grid, true)
    expect(grid.isBlocked(10, 10)).toBe(true) // the ⛲ cell
    let extraBlocked = 0
    for (let r = 9; r <= 11; r++) for (let c = 9; c <= 11; c++) if (!(c === 10 && r === 10) && grid.isBlocked(c, r)) extraBlocked++
    expect(extraBlocked).toBe(0) // the other 8 basin cells are clear
  })

  test('ascii: the whole 3×3 basin blocks', () => {
    const grid = gridWithFountain()
    syncTilesetPropCollision(grid, true) // shrink first
    syncTilesetPropCollision(grid, false) // then restore
    for (let r = 9; r <= 11; r++) for (let c = 9; c <= 11; c++) expect(grid.isBlocked(c, r)).toBe(true)
  })

  test('idempotent + leaves non-fountain collision untouched', () => {
    const grid = gridWithFountain()
    grid.setCollision(2, 2, true) // some unrelated wall
    syncTilesetPropCollision(grid, true)
    syncTilesetPropCollision(grid, true)
    expect(grid.isBlocked(2, 2)).toBe(true) // untouched
    expect(grid.isBlocked(10, 10)).toBe(true)
  })
})
