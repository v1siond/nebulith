/**
 * THE THREE AXES OF A LEAF COLOUR, tested as behaviour a person could check by eye.
 *
 * Each case states a real-world fact first and asserts the arithmetic second, because the arithmetic is only
 * correct if the fact is (an autumn jungle is still green, a beach is brighter and yellower, a deep wood is
 * darker than its glade).
 */
import { foliageColor, lerpHue } from '@/engine/foliageColor'
import { parseColor } from '@/engine/colors'

/** Hue/sat/value of a hex, so a test can talk about "greener" and "darker" rather than about bytes. */
const hsv = (hex: string) => {
  const c = parseColor(hex)!
  const [R, G, B] = [c.r / 255, c.g / 255, c.b / 255]
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min
  let h = 0
  if (d !== 0) {
    if (max === R) h = (60 * ((G - B) / d) + 360) % 360
    else if (max === G) h = 60 * ((B - R) / d) + 120
    else h = 60 * ((R - G) / d) + 240
  }
  return { h: Math.round(h), s: max === 0 ? 0 : d / max, v: max }
}

// The four shades the backend actually serves for these seasons, copied off /api/tilesets.
const SPRING = ['#7cc46a', '#9ed87f', '#5fae4f', '#e79ec8']
const AUTUMN = ['#d2691e', '#c0531a', '#e0a020', '#9c4a1e']

// The biomes as authored, hue and saturation measured off his references (docs/references/SOURCES.md).
const WOODLAND = { leaf: '#597544', seasonality: 1, value: 1 }
const JUNGLE = { leaf: '#4c5c27', seasonality: 0.05, value: 0.8 }
const BEACH = { leaf: '#969945', seasonality: 0.2, value: 1.12 }
const DESERT = { leaf: '#8a7a4d', seasonality: 0.1, value: 1 }

describe('foliageColor, the season axis', () => {
  it('keeps the four shades DISTINCT, which is the variance that was lost last time', () => {
    const out = SPRING.map(s => foliageColor(s, JUNGLE))
    expect(new Set(out).size).toBe(4)
  })

  it('still carries the pink one through, so a spring wood is not all one green', () => {
    const [, , , blossom] = SPRING.map(s => foliageColor(s, WOODLAND)!)
    // #e79ec8 is the blossom shade; on a fully seasonal biome it survives untouched.
    expect(blossom).toBe('#e79ec8')
  })
})

describe('foliageColor, the biome axis', () => {
  it('leaves WOODLAND byte-identical to the season shade, the look he already approved', () => {
    for (const s of [...SPRING, ...AUTUMN]) expect(foliageColor(s, WOODLAND)).toBe(s)
  })

  it('an autumn JUNGLE stays green, because a rainforest does not turn', () => {
    const autumnJungle = foliageColor(AUTUMN[0], JUNGLE)!
    // The served autumn shade is orange at ~25 degrees; the jungle must pull it back to its own green band.
    expect(hsv(AUTUMN[0]).h).toBeLessThan(40)
    expect(hsv(autumnJungle).h).toBeGreaterThan(60)
    expect(hsv(autumnJungle).h).toBeLessThan(100)
  })

  it('an autumn WOODLAND does turn, so seasonality is doing real work in both directions', () => {
    expect(hsv(foliageColor(AUTUMN[0], WOODLAND)!).h).toBeLessThan(40)
  })

  it('JUNGLE is DARKER than woodland for the same shade, the measured "darker trees, denser"', () => {
    const w = hsv(foliageColor(SPRING[0], WOODLAND)!).v
    const j = hsv(foliageColor(SPRING[0], JUNGLE)!).v
    expect(j).toBeLessThan(w)
  })

  it('BEACH is BRIGHTER and YELLOWER, his "brighter greens, even yellowish"', () => {
    const w = foliageColor(SPRING[0], WOODLAND)!
    const b = foliageColor(SPRING[0], BEACH)!
    expect(hsv(b).v).toBeGreaterThan(hsv(w).v)
    expect(hsv(b).h).toBeLessThan(hsv(w).h) // toward yellow
  })

  it('DESERT is olive, never the green it used to serve', () => {
    const d = hsv(foliageColor(SPRING[0], DESERT)!)
    expect(d.h).toBeGreaterThan(30)
    expect(d.h).toBeLessThan(65) // the reference band, 30 to 65, not the old 114
  })

  it('no two biomes agree on the same shade, which is the whole complaint', () => {
    const out = [WOODLAND, JUNGLE, BEACH, DESERT].map(b => foliageColor(SPRING[0], b))
    expect(new Set(out).size).toBe(4)
  })
})

describe('foliageColor, the region axis', () => {
  it('a GLADE is lighter than a DEEP wood in the same biome and season', () => {
    const glade = hsv(foliageColor(SPRING[0], WOODLAND, { leafHue: 4, leafValue: 0.1 })!).v
    const deep = hsv(foliageColor(SPRING[0], WOODLAND, { leafHue: -4, leafValue: -0.08 })!).v
    expect(glade).toBeGreaterThan(deep)
  })

  it('a region shift is SMALL, it must not read as a different biome', () => {
    const plain = hsv(foliageColor(SPRING[0], JUNGLE)!)
    const shifted = hsv(foliageColor(SPRING[0], JUNGLE, { leafHue: 4, leafValue: 0.1 })!)
    expect(Math.abs(shifted.h - plain.h)).toBeLessThanOrEqual(6)
  })
})

describe('foliageColor, refusing to invent', () => {
  it('serves nothing when the tree has no season shade', () => {
    expect(foliageColor(undefined, WOODLAND)).toBeUndefined()
  })

  it('serves nothing for an unparseable shade rather than a guessed colour', () => {
    expect(foliageColor('not-a-colour', WOODLAND)).toBeUndefined()
  })

  it('returns the season shade untouched when the generator says nothing about foliage', () => {
    expect(foliageColor(SPRING[0], undefined)).toBe(SPRING[0])
    expect(foliageColor(SPRING[0], {})).toBe(SPRING[0])
  })

  it('a biome that omits seasonality behaves as fully seasonal, never silently evergreen', () => {
    expect(foliageColor(AUTUMN[0], { leaf: '#4c5c27' })).toBe(AUTUMN[0])
  })
})

describe('lerpHue takes the short way round', () => {
  it('crosses the wrap instead of sweeping the long way', () => {
    expect(lerpHue(350, 10, 0.5)).toBeCloseTo(0, 5)
  })

  it('ends exactly on each endpoint', () => {
    expect(lerpHue(80, 200, 0)).toBeCloseTo(80, 5)
    expect(lerpHue(80, 200, 1)).toBeCloseTo(200, 5)
  })
})
