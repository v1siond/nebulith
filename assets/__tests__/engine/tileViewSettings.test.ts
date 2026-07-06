import { resolveTileSize, resolveTilePose } from '@/engine/tileset/tileViewSettings'

describe('per-view tile settings cascade', () => {
  test('unset views → size undefined; pose falls back to the shared pose', () => {
    const tile = { pose: { rot: 0.5 } }
    expect(resolveTileSize(tile, 'iso')).toBeUndefined()
    expect(resolveTilePose(tile, 'iso')).toEqual({ rot: 0.5 })
  })

  test('per-view size is returned per view; other views unaffected', () => {
    const tile = { views: { iso: { size: 3 }, '2d': { size: 1.5 } } }
    expect(resolveTileSize(tile, 'iso')).toBe(3)
    expect(resolveTileSize(tile, '2d')).toBe(1.5)
    expect(resolveTileSize(tile, 'top')).toBeUndefined()
  })

  test('per-view pose overrides shared pose; absent view pose falls back to shared', () => {
    const tile = { pose: { rot: 0.1 }, views: { iso: { pose: { rot: 0.9 } } } }
    expect(resolveTilePose(tile, 'iso')).toEqual({ rot: 0.9 })
    expect(resolveTilePose(tile, '2d')).toEqual({ rot: 0.1 })
  })

  test('empty tile / undefined tile → all undefined', () => {
    expect(resolveTileSize({}, 'iso')).toBeUndefined()
    expect(resolveTilePose(undefined, 'top')).toBeUndefined()
  })
})
