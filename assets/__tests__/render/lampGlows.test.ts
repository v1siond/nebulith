import { assetLight, collectLampGlows, LAMP_GLOW } from '../../engine/render/shared'
import type { IsometricGrid } from '../../engine/IsometricGrid'
import type { GridAsset } from '../../engine/IsometricGrid'

// collectLampGlows only reads grid.assets, so a minimal stand-in exercises the real filter.
const gridWith = (assets: unknown[]) => ({ assets } as unknown as IsometricGrid)
const center = (col: number, row: number) => ({ x: col * 10, y: row * 10 })
// 3rd arg is now the per-cell PIXEL unit (tilePx): a light's `distance` (cells) → distance·tilePx px radius.
const TILE_PX = 32

describe('assetLight — the ONE resolver for a tile\'s night glow pool', () => {
  test('an explicit `light` SETTING drives radius (distance) + strength (intensity) + hue (color)', () => {
    const a = { type: 'lamp_post', label: 'lamp', light: { intensity: 0.4, distance: 6, color: '#00ff00' } } as unknown as GridAsset
    expect(assetLight(a)).toEqual({ rgb: '0, 255, 0', radiusTiles: 6, intensity: 0.4 })
  })

  test('`on: false` casts NO pool (a switched-off lamp)', () => {
    const a = { type: 'lamp_post', label: 'lamp', light: { intensity: 1, distance: 3, on: false } } as unknown as GridAsset
    expect(assetLight(a)).toBeNull()
  })

  test('intensity is clamped to 0..1; a missing colour falls back to the warm default', () => {
    const a = { type: 'x', light: { intensity: 5, distance: 2 } } as unknown as GridAsset
    expect(assetLight(a)).toEqual({ rgb: LAMP_GLOW.rgb, radiusTiles: 2, intensity: 1 })
  })

  test('a lamp/lantern with NO explicit light falls back to the default warm pool', () => {
    expect(assetLight({ type: 'lamp' } as unknown as GridAsset)).toEqual({ rgb: LAMP_GLOW.rgb, radiusTiles: LAMP_GLOW.radiusTiles, intensity: 1 })
    expect(assetLight({ type: 'lamp_post', label: 'lamp' } as unknown as GridAsset)).toEqual({ rgb: LAMP_GLOW.rgb, radiusTiles: LAMP_GLOW.radiusTiles, intensity: 1 })
  })

  test('a non-lamp with no light casts nothing', () => {
    expect(assetLight({ type: 'building', label: 'wall_brick_c' } as unknown as GridAsset)).toBeNull()
    expect(assetLight({ type: 'lamp_post', label: 'post' } as unknown as GridAsset)).toBeNull()
  })
})

describe('collectLampGlows — night pool anchors, sized by each asset\'s light', () => {
  test('the lamp CELL of the lamp_post composition (label === "lamp") casts the default pool', () => {
    // the regression: lamps became compositions of type "lamp_post"; the pool must key on the cell label
    const g = gridWith([{ col: 2, row: 3, type: 'lamp_post', label: 'lamp' }])
    const out = collectLampGlows(g, center, TILE_PX, 5, 800, 600)
    expect(out).toHaveLength(1)
    // default radius = LAMP_GLOW.radiusTiles(3.2) × tilePx(32); warm default rgb, full intensity.
    expect(out[0]).toMatchObject({ x: 20, r: LAMP_GLOW.radiusTiles * TILE_PX, rgb: LAMP_GLOW.rgb, intensity: 1 })
  })

  test('a per-asset light DISTANCE sizes the pool radius (distance × tilePx)', () => {
    const near = gridWith([{ col: 2, row: 2, type: 'lamp_post', label: 'lamp', light: { intensity: 1, distance: 2 } }])
    const far = gridWith([{ col: 2, row: 2, type: 'lamp_post', label: 'lamp', light: { intensity: 1, distance: 8 } }])
    expect(collectLampGlows(near, center, TILE_PX, 0, 800, 600)[0].r).toBeCloseTo(2 * TILE_PX)
    expect(collectLampGlows(far, center, TILE_PX, 0, 800, 600)[0].r).toBeCloseTo(8 * TILE_PX)
  })

  test('a per-asset light INTENSITY rides onto the pool (drives its strength)', () => {
    const g = gridWith([{ col: 2, row: 2, type: 'lamp_post', label: 'lamp', light: { intensity: 0.3, distance: 3 } }])
    expect(collectLampGlows(g, center, TILE_PX, 0, 800, 600)[0].intensity).toBeCloseTo(0.3)
  })

  test('an `on: false` light casts NO pool (negative case)', () => {
    const g = gridWith([{ col: 2, row: 2, type: 'lamp_post', label: 'lamp', light: { intensity: 1, distance: 3, on: false } }])
    expect(collectLampGlows(g, center, TILE_PX, 0, 800, 600)).toHaveLength(0)
  })

  test('ANY asset carrying a light casts a pool — not just lamps', () => {
    const g = gridWith([{ col: 2, row: 2, type: 'window', light: { intensity: 0.6, distance: 4, color: '#88bbff' } }])
    const out = collectLampGlows(g, center, TILE_PX, 0, 800, 600)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ r: 4 * TILE_PX, rgb: '136, 187, 255', intensity: 0.6 })
  })

  test('still includes the legacy single lamp/lantern prop (type === "lamp")', () => {
    const g = gridWith([{ col: 1, row: 1, type: 'lamp' }, { col: 4, row: 4, type: 'lantern' }])
    expect(collectLampGlows(g, center, TILE_PX, 5, 800, 600)).toHaveLength(2)
  })

  test('excludes non-lamp parts (the post cell, buildings, trees)', () => {
    const g = gridWith([
      { col: 1, row: 1, type: 'lamp_post', label: 'post' },
      { col: 2, row: 2, type: 'building', label: 'wall_brick_c' },
      { col: 3, row: 3, type: 'tree', label: 'tree_top' },
    ])
    expect(collectLampGlows(g, center, TILE_PX, 5, 800, 600)).toHaveLength(0)
  })

  test('drops lamps whose pool is fully off-screen', () => {
    const g = gridWith([{ col: 500, row: 500, type: 'lamp_post', label: 'lamp' }])
    expect(collectLampGlows(g, center, TILE_PX, 5, 800, 600)).toHaveLength(0)
  })
})
