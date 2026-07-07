import { resolveTileHeight } from '@/engine/tileset/tileHeight'

describe('resolveTileHeight — iso block count: instance override ?? tile default ?? 0 (flat)', () => {
  test('flat by default — no tile default, no override', () => {
    expect(resolveTileHeight({}, {})).toBe(0)
    expect(resolveTileHeight(undefined, undefined)).toBe(0)
  })

  test('the tile default applies when there is no instance override', () => {
    expect(resolveTileHeight({ height: 1 }, {})).toBe(1)
    expect(resolveTileHeight({ height: 2 }, undefined)).toBe(2)
  })

  test('an instance override wins over the tile default (incl. an explicit 0 = force flat)', () => {
    expect(resolveTileHeight({ height: 1 }, { height: 3 })).toBe(3)
    expect(resolveTileHeight({ height: 1 }, { height: 0 })).toBe(0)
  })

  test('negative heights clamp to flat', () => {
    expect(resolveTileHeight({ height: -2 }, {})).toBe(0)
  })
})
