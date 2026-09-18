/**
 * A REGION SET YOU WALK THROUGH, not one you stumble across.
 *
 * *"none of the regions from volcanic type are different and they don't look like volcanic regions at all.
 * there's no sense of getting close to the volcano for example"*, and the rule `REGIONS.md` §1.2 draws from it:
 * a set that describes a journey has to be LAID OUT as one.
 *
 * `partitionSubZones` was a nearest-seed Voronoi, so every kind landed in blobs all over the map. No region
 * content can produce a sense of approach on top of that, which is why the volcanic bands read as a wood even
 * with the right species and floors in them. These tests are about WHERE a region lands, never what is in it.
 */
import { partitionSubZones } from '@/engine/stageGenerator'
import type { GeneratorSubZone } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'

/** Lay a set with the engine's own partition. Only what the partition reads is supplied, so nothing else can
 *  drift into the answer. */
function lay(regionLayout: 'rings' | 'bands' | 'scatter', zones: readonly GeneratorSubZone[], cols = 41, rows = 41) {
  const ctx = { cols, rows, regionLayout, rand: makeRng(7) } as unknown as Parameters<typeof partitionSubZones>[0]
  return partitionSubZones(ctx, zones)
}

/** Five regions of equal weight, so POSITION is the only thing under test. */
const FIVE: GeneratorSubZone[] = ['a', 'b', 'c', 'd', 'e'].map(key => ({ key, name: key, weight: 1 }))

const regionAt = (map: ReturnType<typeof lay>, col: number, row: number): string | undefined => map[row]?.[col]?.key

describe('an ordered region set lands in its order', () => {
  it('rings: the FIRST region is at the middle and the LAST is at the rim', () => {
    const s = lay('rings', FIVE)
    const mid = regionAt(s, 20, 20)
    const corner = regionAt(s, 0, 0)
    expect(mid).toBe('a')
    expect(corner).toBe('e')
  })

  it('bands: the FIRST region is at the SOUTH edge, where the entrance is', () => {
    const s = lay('bands', FIVE)
    // A map's entrance is always south, so band 0 has to be the one you walk into.
    expect(regionAt(s, 20, 40)).toBe('a')
    expect(regionAt(s, 20, 0)).toBe('e')
  })

  it('bands run ACROSS the map, so a row is one region and a column crosses them all', () => {
    const s = lay('bands', FIVE)
    const acrossOneRow = new Set([4, 12, 20, 28, 36].map(col => regionAt(s, col, 38)))
    const downOneColumn = new Set([2, 12, 20, 28, 38].map(row => regionAt(s, 20, row)))
    expect(acrossOneRow.size).toBe(1)          // one band, the whole way across
    expect(downOneColumn.size).toBeGreaterThanOrEqual(4) // and you cross nearly all of them going up
  })

  it('the SCATTER is untouched, because a meadow genuinely has no gradient', () => {
    // *"a meadow is not that wet, and rivers aren't gonna be as prominent as in a swamp"*: the hedge is where
    // the hedge is. A scatter must NOT come out as bands, or the change has eaten the one layout that was right.
    const s = lay('scatter', FIVE)
    const acrossOneRow = new Set([4, 12, 20, 28, 36].map(col => regionAt(s, col, 38)))
    expect(acrossOneRow.size).toBeGreaterThan(1)
  })

  /**
   * THE ONE THE REGION SHEET FOUND, and it was invisible to every test above.
   *
   * `weight` is a share of the MAP. The first version cut on the coordinate, which is right for bands and
   * wrong for rings, because a ring is an annulus: holding the innermost tenth of the RADIUS is holding a
   * hundredth of the AREA. Measured on a real volcanic build, the crater at served weight 1 of 12 came out at
   * 0 per cent of the map, so the thing you are supposed to be approaching was not there.
   */
  it.each(['rings', 'bands'] as const)('%s: weight is a share of the MAP, not of the coordinate', layout => {
    const zones: GeneratorSubZone[] = [
      { key: 'a', name: 'a', weight: 1 }, { key: 'b', name: 'b', weight: 2 },
      { key: 'c', name: 'c', weight: 3 }, { key: 'd', name: 'd', weight: 6 },
    ]
    const map = lay(layout, zones, 60, 60)
    const seen = new Map<string, number>()
    for (const row of map) for (const z of row) if (z) seen.set(z.key, (seen.get(z.key) ?? 0) + 1)
    const total = 60 * 60
    const share = (k: string) => (seen.get(k) ?? 0) / total
    // served 1:2:3:6 of 12, so 8%, 17%, 25% and 50% of the cells, within a couple of points for the wobble
    expect(share('a')).toBeGreaterThan(0.05)
    expect(share('a')).toBeLessThan(0.12)
    expect(share('d')).toBeGreaterThan(0.44)
    expect(share('d')).toBeLessThan(0.56)
  })

  it('weight decides THICKNESS, so a heavy first region reaches further from the middle', () => {
    const heavy: GeneratorSubZone[] = [{ key: 'a', name: 'a', weight: 12 }, ...FIVE.slice(1)]
    const thin = lay('rings', FIVE)
    const fat = lay('rings', heavy)
    const reach = (s: ReturnType<typeof lay>) =>
      [...Array(20).keys()].filter(d => regionAt(s, 20 + d, 20) === 'a').length
    expect(reach(fat)).toBeGreaterThan(reach(thin))
  })
})
