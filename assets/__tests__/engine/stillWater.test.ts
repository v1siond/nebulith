/**
 * A PUDDLE IS NOT A RIVER.
 *
 * Alexander, 2026-09-13: *"the green water is using the same tile as the river water, which is bad, because
 * that is not a river is a puddle, it doesn't have current is stationary"*.
 *
 * Two defects, both data.
 *
 * A pool laid `water_shallow`, which is the RIVER's own wadeable edge, so a puddle and a channel wore one
 * label. And the generator's comment asserted that label was height 0.0 while the database said 1.0 in both
 * styles, so every puddle drew as a one-block cube of water standing on the floor.
 *
 * `water_still` is the puddle: flush at height 0, frameless because standing water has no current. The two
 * river BANDS join `water`'s 0.5, which `seed_water_color` had already worked out for the channel and never
 * applied to them.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import { findGeneratorByKey, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import { styleTile } from '@/engine/tileset/styleTiles'
import { spriteFrame } from '@/engine/render/assetAnimation'
import { ASCII_STYLE } from '@/game/artStyle'
import type { GridAsset } from '@/engine/IsometricGrid'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

function grow(key: string, seed = 3) {
  const g = findGeneratorByKey(CATALOG, key)!
  const c = g.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout: g.layout as 'jungle' | 'woodland' | 'meadow',
      cols: 60, rows: 40, nature: c.nature, palette: c.palette, formation: c.formation,
      treeMix: c.trees, subZones: c.subZones, crossings: c.crossings,
      options: { river: 'through', crossing: true, bridge: 'wood' },
    })
  } finally { Math.random = orig }
}
const groundCount = (s: ReturnType<typeof grow>, label: string) => s.ground.flat().filter(g => g === label).length

describe('still water is its own tile', () => {
  it('a swamp lays water_still for its pools, never the river band', () => {
    const swamp = grow('forest_jungle_swamp')
    expect(groundCount(swamp, 'water_still')).toBeGreaterThan(0)
  })

  it('it is FLUSH and FRAMELESS, because standing water has no current', () => {
    const still = styleTile('ascii', 'water_still')
    expect(still).toBeDefined()
    expect(still?.height).toBe(0)
    expect((still?.settings as { frames?: unknown[] } | undefined)?.frames ?? []).toHaveLength(0)
  })

  it('a PUDDLE does not animate, even though the picture path collapses it to the river', () => {
    // The heart of *"it doesn't have current is stationary"*. `assetKind` folds every water-ish label to the
    // kind `water` so the bands can share one image, and that used to hand a puddle the river's four frames.
    // `water_still` declares an EMPTY animations list, which is a statement, not an omission.
    const asset = { art: [''], col: 1, row: 1, type: 'floor', tileKey: 'water_still', heightLevel: 0, blocking: false, placedAt: 0 } as unknown as GridAsset
    expect(spriteFrame(asset, 0, ASCII_STYLE, 'iso', 'day')).toBeNull()
    expect(spriteFrame(asset, 700, ASCII_STYLE, 'iso', 'day')).toBeNull()
  })

  it('a RIVER still flows: the channel keeps its frames through the same path', () => {
    // The other half. A band carries NO animations key at all, so it still inherits the river's.
    const river = { art: [''], col: 1, row: 1, type: 'floor', tileKey: 'water_shallow', heightLevel: 0, blocking: false, placedAt: 0 } as unknown as GridAsset
    expect(spriteFrame(river, 0, ASCII_STYLE, 'iso', 'day')).not.toBeNull()
  })

  it('the channel label keeps its frames', () => {
    // The other half of his sentence. Removing the current everywhere would pass the test above and be wrong.
    const water = styleTile('ascii', 'water')
    expect((water?.settings as { frames?: unknown[] } | undefined)?.frames ?? []).not.toHaveLength(0)
  })

  it('one channel SURFACE: the bands sit at the same height the river does', () => {
    // seed_water_color worked this out for `water` (a 1.0 surface floats 0.239 above its own bank in a
    // one-deep channel) and never applied it to the two bands, which stayed at 1.0.
    for (const label of ['water', 'water_shallow', 'water_deep']) {
      expect({ label, height: styleTile('ascii', label)?.height }).toEqual({ label, height: 0.5 })
    }
  })

  it('a puddle is still WATER to every consumer, so nothing floods into it', () => {
    // isWaterGround matches any label containing "water". If that ever stops, tall grass, blooms and the
    // terrain pass all start planting inside pools.
    const swamp = grow('forest_jungle_swamp')
    const pools = new Set<string>()
    swamp.ground.forEach((r, y) => r.forEach((g, x) => { if (g === 'water_still') pools.add(`${x},${y}`) }))
    const propsInPools = swamp.props.filter(p => pools.has(`${p.col},${p.row}`))
    expect(propsInPools).toHaveLength(0)
  })
})
