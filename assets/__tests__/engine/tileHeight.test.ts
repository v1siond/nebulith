import { resolveTileHeight, partialBlockScale } from '@/engine/tileset/tileHeight'

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

// Render geometry ONLY: how tall to draw a tile's base layer given its DB block-height. The VALUE comes from
// the DB (`blocks`, via resolveTileHeight); this pure fn just turns it into pixels. It invents NOTHING — a
// flat tile is thin because its DB height IS small (e.g. 0.1), not because the frontend decided so.
describe('partialBlockScale — draw a tile at its OWN DB block-height (no invented flat constant)', () => {
  test('a sub-block tile draws that fraction: a DB height of 0.1 → a 0.1 slab', () => {
    expect(partialBlockScale(0.1)).toBe(0.1) // a flat 0.1-block floor/flower → a thin 0.1 slab
    expect(partialBlockScale(0.5)).toBe(0.5) // whatever fraction the DB says
  })

  test('a standing tile\'s base layer is a full block (its COUNT carries the total height)', () => {
    expect(partialBlockScale(1)).toBe(1)
    expect(partialBlockScale(3)).toBe(1) // 3 blocks tall = 3 full layers, each layer scale 1
  })

  test('zero / negative → nothing to draw (clamped)', () => {
    expect(partialBlockScale(0)).toBe(0)
    expect(partialBlockScale(-2)).toBe(0)
  })

  test('it reads the height it is GIVEN — a bigger DB height draws a bigger slab (no ceiling, no floor constant)', () => {
    // Proves there is no invented "flat = 0.1": feed 0.2 and it draws 0.2, feed 0.05 and it draws 0.05.
    expect(partialBlockScale(0.2)).toBe(0.2)
    expect(partialBlockScale(0.05)).toBe(0.05)
  })
})
