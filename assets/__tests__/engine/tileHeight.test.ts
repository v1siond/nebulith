import { resolveTileHeight, blockLayers, layerBlockScale } from '@/engine/tileset/tileHeight'

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
describe('blockLayers / layerBlockScale — a tile draws at its EXACT height, not rounded to whole blocks', () => {
  // Blocks are a unit of MEASUREMENT, not a constraint to integers (Alexander: "we can increase from 0.001
  // block size … doesn't necessarilly mean everything is handled by integer numbers"). The renderer stacks
  // `blockLayers` equal layers of `layerBlockScale` each, and their product is the height it was GIVEN.
  const total = (blocks: number) => blockLayers(blocks) * layerBlockScale(blocks)

  test('layers x layerScale is ALWAYS the exact height — nothing is truncated', () => {
    for (const h of [0, 0.001, 0.1, 0.5, 1, 1.5, 2, 2.75, 4, 4.5, 7.25]) {
      expect(total(h)).toBeCloseTo(h, 10)
    }
  })

  test('a sub-block tile is ONE layer of that fraction (a flat 0.1 floor stays a 0.1 slab)', () => {
    expect(blockLayers(0.1)).toBe(1)
    expect(layerBlockScale(0.1)).toBeCloseTo(0.1, 10)
    expect(blockLayers(0.001)).toBe(1)
    expect(layerBlockScale(0.001)).toBeCloseTo(0.001, 10)
  })

  test('a whole-number tile is N full layers — unchanged from before', () => {
    expect(blockLayers(1)).toBe(1)
    expect(layerBlockScale(1)).toBe(1)
    expect(blockLayers(4)).toBe(4)
    expect(layerBlockScale(4)).toBe(1)
  })

  test('a FRACTIONAL tile above 1 reaches its true height (4.5 is 4.5 tall, not 4)', () => {
    expect(blockLayers(4.5)).toBe(5)          // one more layer to carry the remainder…
    expect(layerBlockScale(4.5)).toBeCloseTo(0.9, 10) // …each slightly shorter, so the total is exactly 4.5
    expect(total(4.5)).toBeCloseTo(4.5, 10)
  })

  test('zero / negative → nothing to draw (clamped)', () => {
    expect(total(0)).toBe(0)
    expect(total(-2)).toBe(0)
    expect(blockLayers(0)).toBe(1) // still one (degenerate) layer, but of zero height
  })
})
