import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { serializeGrid, deserializeToGrid, type TemplateData } from '@/lib/api'
import { entitiesToAssets, entitiesFromAssets, styleToAssets, styleFromAssets } from '@/lib/gridCodec'
import type { Entity } from '@/game/types'

// Wrap a serialized grid in the minimal TemplateData shape the loader consumes, going
// through JSON.stringify/parse first — that is exactly what a JSON column does
// on save/load, so this proves the field survives the real persistence path.
function roundTripGrid(grid: IsometricGrid): IsometricGrid {
  const s = serializeGrid(grid)
  const wire = JSON.parse(JSON.stringify(s)) as { groundData: string[][]; heightData: number[][]; assetsData: GridAsset[] }
  const data: TemplateData = {
    id: 't', name: 'n', description: null, category: 'custom',
    cols: grid.cols, rows: grid.rows, cellSize: grid.cellSize, isoScale: grid.isoScale,
    spawnCol: 0, spawnRow: 0,
    groundData: wire.groundData, heightData: wire.heightData, assetsData: wire.assetsData,
    connectors: [], entities: [], quests: [], thumbnail: null, isPublic: false, tags: [],
    createdAt: '', updatedAt: '',
  }
  return deserializeToGrid(data)
}

describe('art-style persistence — override + active style survive the codec', () => {
  it('an asset tileOverride round-trips through serialize → JSON → deserialize', () => {
    const grid = new IsometricGrid({ cols: 8, rows: 8, cellSize: 40, isoScale: 1 })
    grid.placeAsset(['♣'], 2, 3, { type: 'tree', blocking: true, color: '#2e8b2e' })
    // pin this ONE tree to a specific Library tile
    grid.assets[grid.assets.length - 1].tileOverride = 'emoji:tree'

    const back = roundTripGrid(grid)
    const tree = back.assets.find(a => a.col === 2 && a.row === 3 && a.type !== 'floor')
    expect(tree).toBeDefined()
    expect(tree!.tileOverride).toBe('emoji:tree')
  })

  it('assets WITHOUT an override stay override-free after the round-trip', () => {
    const grid = new IsometricGrid({ cols: 4, rows: 4, cellSize: 40, isoScale: 1 })
    grid.placeAsset(['@'], 1, 1, { type: 'tree' })
    const back = roundTripGrid(grid)
    expect(back.assets.find(a => a.type !== 'floor')!.tileOverride).toBeUndefined()
  })

  it('an entity tileOverride round-trips through the entity marker codec', () => {
    const enemy: Entity = {
      id: 'e1', kind: 'enemy', col: 5, row: 5, enemyType: 'skeleton',
      baseStats: { strength: 8, intelligence: 4, defense: 2, maxHp: 24 },
      tileOverride: 'emoji:enemy',
    }
    expect(entitiesFromAssets(entitiesToAssets([enemy]))).toEqual([enemy])
    expect(entitiesFromAssets(entitiesToAssets([enemy]))[0].tileOverride).toBe('emoji:enemy')
  })

  it('the active style id round-trips as an off-grid marker (and JSON survives it)', () => {
    const assets = styleToAssets('emoji')
    expect(assets).toHaveLength(1)
    expect(assets[0].col).toBe(-1) // off-grid → never drawn by the tile/asset renderers
    const wire = JSON.parse(JSON.stringify(assets)) as GridAsset[]
    expect(styleFromAssets(wire)).toBe('emoji')
  })

  it('the ASCII (default) style writes NO marker — nothing to clean up on load', () => {
    expect(styleToAssets('ascii')).toEqual([])
    expect(styleToAssets(null)).toEqual([])
    expect(styleFromAssets([])).toBeNull()
  })
})
