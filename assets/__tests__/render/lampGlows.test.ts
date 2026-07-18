import { collectLampGlows } from '../../engine/render/shared'
import type { IsometricGrid } from '../../engine/IsometricGrid'

// collectLampGlows only reads grid.assets, so a minimal stand-in exercises the real filter.
const gridWith = (assets: unknown[]) => ({ assets } as unknown as IsometricGrid)
const center = (col: number, row: number) => ({ x: col * 10, y: row * 10 })

describe('collectLampGlows — night pool anchors', () => {
  test('includes the lamp CELL of the lamp_post composition (label === "lamp")', () => {
    // the regression: lamps became compositions of type "lamp_post"; the pool must key on the cell label
    const g = gridWith([{ col: 2, row: 3, type: 'lamp_post', label: 'lamp' }])
    const out = collectLampGlows(g, center, 32, 5, 800, 600)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ x: 20, r: 32 })
  })

  test('still includes the legacy single lamp/lantern prop (type === "lamp")', () => {
    const g = gridWith([{ col: 1, row: 1, type: 'lamp' }, { col: 4, row: 4, type: 'lantern' }])
    expect(collectLampGlows(g, center, 32, 5, 800, 600)).toHaveLength(2)
  })

  test('excludes non-lamp parts (the post cell, buildings, trees)', () => {
    const g = gridWith([
      { col: 1, row: 1, type: 'lamp_post', label: 'post' },
      { col: 2, row: 2, type: 'building', label: 'wall_brick_c' },
      { col: 3, row: 3, type: 'tree', label: 'tree_top' },
    ])
    expect(collectLampGlows(g, center, 32, 5, 800, 600)).toHaveLength(0)
  })

  test('drops lamps whose pool is fully off-screen', () => {
    const g = gridWith([{ col: 500, row: 500, type: 'lamp_post', label: 'lamp' }])
    expect(collectLampGlows(g, center, 32, 5, 800, 600)).toHaveLength(0)
  })
})
