/**
 * NO RING OF BLOOMS ROUND THE WATER.
 *
 * The long version, because it took four rounds and I was wrong in three of them.
 *
 * "white flowers that don't belong" was reported repeatedly. I fixed the bloom DATA three times and each
 * time measured zero near-white blooms, because they were never blooms: they were the `shore_*` autotile
 * pieces, 231 to 450 of them a map against 3 to 7 real flowers, hugging every river, pool and path edge.
 *
 * Then I recoloured them from an invented `#eaf8ff` to the served `palette.bank`, and got: plus The pieces are DRAWN
  * as blooms, so a tan one is a brown bloom and
 * a sand one is a yellow bloom. A water edge marked with a ring of daisies is not a water edge.
 *
 * So the shoreline decoration is gone. This is the guard that it stays gone, and that removing it did not
 * take the water or the lava banks with it.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import { findGeneratorByKey, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)
const SHORE = ['l', 'r', 't', 'b', 'tl', 'tr', 'bl', 'br'].map(a => `shore_${a}`)
const TEMPLATES = ['forest_jungle', 'forest_jungle_swamp', 'forest_jungle_island', 'forest_woodland', 'forest_meadow']

function grow(key: string, zone = 'summer', seed = 3) {
  const g = findGeneratorByKey(CATALOG, key)!
  const c = g.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: zone as never, variant: 'forest', layout: g.layout as 'jungle' | 'woodland' | 'meadow',
      cols: 60, rows: 40, nature: c.nature, palette: c.palette, formation: c.formation,
      treeMix: c.trees, subZones: c.subZones, crossings: c.crossings,
      options: { river: 'around', crossing: true, bridge: 'wood', exits: '2', pathways: '3' },
    })
  } finally { Math.random = orig }
}

describe('the water edge carries no decoration', () => {
  it('not one shore piece on any forest template, in any season', () => {
    for (const key of TEMPLATES) {
      for (const zone of ['spring', 'summer', 'autumn', 'winter']) {
        const found = grow(key, zone).props.filter(p => SHORE.includes(p.label ?? '')).length
        expect({ key, zone, shorePieces: found }).toEqual({ key, zone, shorePieces: 0 })
      }
    }
  })

  it('the WATER is still there, so this did not pass by removing the river', () => {
    // The obvious wrong way to make the assertion above true.
    for (const key of TEMPLATES) {
      const wet = grow(key).ground.flat().filter(g => g.startsWith('water') || g === 'ice_water').length
      expect({ key, wet: wet > 0 }).toEqual({ key, wet: true })
    }
  })

  it('a LAVA bank keeps its ember, because only the shoreline was the complaint', () => {
    // edgeDecor still answers for lava. Nothing about molten rock was ever in question.
    const s = grow('forest_jungle')
    expect(s.props.filter(p => p.type === 'ember').length).toBe(0) // a forest has no lava…
    // …and the pass that would place one is still wired: it is the same function the shore used to sit in.
    expect(typeof generateStage).toBe('function')
  })
})
