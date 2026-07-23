import { IsometricGrid } from '@/engine/IsometricGrid'
import { serializeGrid, deserializeToGrid } from '@/lib/api'

// #77/#78 — per-element dimensions must SAVE with the template. serializeGrid captures the whole asset
// and deserialize clones every field, so scaleX/scaleY/scaleZ/scale must survive the JSON DB column.
// This guards the contract: deserialize previously cherry-picked columns and DROPPED fields like footprint.

const hydrate = (grid: IsometricGrid) => {
  const wire = JSON.parse(JSON.stringify(serializeGrid(grid))) // simulate the Postgres JSON column
  return deserializeToGrid({
    cols: 4, rows: 4, cellSize: 64, isoScale: 1.4,
    groundData: grid.groundSlugs(), heightData: grid.height, assetsData: wire.assetsData,
  } as unknown as Parameters<typeof deserializeToGrid>[0])
}

describe('per-element dimensions persist through serialize → JSON → deserialize', () => {
  it('carries scaleX / scaleY / scaleZ / scale on a placed asset', () => {
    const grid = new IsometricGrid({ cols: 4, rows: 4, cellSize: 64 })
    grid.placeAsset(['🌲'], 2, 1, { type: 'tree' })
    const asset = grid.getAssetsAtCell(2, 1).find(a => a.type !== 'floor')!
    asset.scaleX = 1.5
    asset.scaleY = 3
    asset.scaleZ = 2
    asset.scale = 1.25

    const back = hydrate(grid).getAssetsAtCell(2, 1).find(a => a.type !== 'floor')!
    expect(back.scaleX).toBe(1.5)
    expect(back.scaleY).toBe(3)
    expect(back.scaleZ).toBe(2)
    expect(back.scale).toBe(1.25)
  })

  it('leaves per-axis dims undefined on an asset that never set them (default = natural size)', () => {
    const grid = new IsometricGrid({ cols: 4, rows: 4, cellSize: 64 })
    grid.placeAsset(['🌸'], 0, 0, { type: 'flower' })

    const back = hydrate(grid).getAssetsAtCell(0, 0).find(a => a.type !== 'floor')!
    expect(back.scaleX).toBeUndefined()
    expect(back.scaleY).toBeUndefined()
    expect(back.scaleZ).toBeUndefined()
  })
})
