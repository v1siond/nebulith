import { resolveTileHeight, blockLayers, layerBlockScale } from '@/engine/tileset/tileHeight'

// FLAT TILES NO LONGER EXIST. Alexander, 2026-07-27: "all tiles/blocks are height 1, GLOBAL, no exceptions".
// Height is a property of the PLACED BLOCK, never of the art tile — "tiles only have data when they're
// assigned to a cell … the generator should assign the value when creating something". So the resolution is
// `placement ?? 1`, with the art tile deliberately unread; there is no tile-default tier left to fall back to.
describe('resolveTileHeight — iso block count: the PLACED block\'s height ?? 1, art never consulted', () => {
  test('ONE block by default — an ordinary placement with no height pinned', () => {
    expect(resolveTileHeight({}, {})).toBe(1)
    expect(resolveTileHeight(undefined, undefined)).toBe(1)
  })

  test('the PLACEMENT carries the height — a generator/editor value of any size lands as given', () => {
    expect(resolveTileHeight(undefined, { height: 3 })).toBe(3)
    expect(resolveTileHeight({}, { height: 0.5 })).toBe(0.5) // blocks are a measurement, not an integer
  })

  test('the ART TILE is never read — a stray height on the picture cannot move the block', () => {
    // That stray art `0` is what sank the road below the height-1 grass (the trench). The art file is a
    // picture; whatever number it carries, the placed block decides.
    expect(resolveTileHeight({ height: 0 }, {})).toBe(1)
    expect(resolveTileHeight({ height: 7 }, {})).toBe(1)
    expect(resolveTileHeight({ height: 7 }, { height: 2 })).toBe(2)
  })

  test('zero and negative clamp UP to one block — flat is not a state a block can be in', () => {
    expect(resolveTileHeight({}, { height: 0 })).toBe(1)
    expect(resolveTileHeight({}, { height: -2 })).toBe(1)
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
