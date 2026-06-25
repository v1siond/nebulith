import { IsometricGrid } from '@/engine/IsometricGrid'

describe('IsometricGrid.placeAsset — building labels survive so the facade renders (not a voxel house per cell)', () => {
  it('keeps label + buildingType on building cells, drops label on trees (load-bearing)', () => {
    const grid = new IsometricGrid({ cols: 6, rows: 6, cellSize: 32 })
    grid.placeAsset(['▀'], 1, 1, { type: 'building', label: 'roof', buildingType: 'house', color: '#a00' })
    grid.placeAsset(['@'], 3, 3, { type: 'tree', label: 'tree_interior', color: '#0a0' })
    const b = grid.assets.find(a => a.type === 'building')
    const t = grid.assets.find(a => a.type === 'tree')
    expect(b?.label).toBe('roof') // building keeps it → per-cell facade
    expect(b?.buildingType).toBe('house')
    expect(t?.label).toBeUndefined() // tree drops it → tree render path
  })
})
