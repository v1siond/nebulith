/**
 * THE WHITE THINGS ALL OVER THE MAP WERE THE RIVER BANKS.
 *
 * Alexander, 2026-09-13, after three rounds of me hunting the wrong label: *"I don't know what the fuck is the
 * name of those white flowers, but I want them OUUUUUUUUT"*.
 *
 * They were never flowers. Measured across six templates and three seasons, a map carried 231 to 450 near-white
 * `shore_*` props against 3 to 7 blooms, and they hug every river, pool and path edge, which at map scale reads
 * as exactly the line of white blossom he kept pointing at. `shorePiece` minted `#eaf8ff` (and a frost
 * `#bfe6f5`) while `palette.bank` was served and ignored, and the tile row itself was authored near-white too.
 *
 * This is the guard against all three coming back: the served colour, the tile's own, and the count on a real
 * generated map.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import { findGeneratorByKey, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import { styleTile } from '@/engine/tileset/styleTiles'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)
const SHORE = ['l', 'r', 't', 'b', 'tl', 'tr', 'bl', 'br'].map(a => `shore_${a}`)

const rgb = (c: string): [number, number, number] => {
  const m = /rgb\((\d+), *(\d+), *(\d+)\)/.exec(c)
  if (m) return [+m[1], +m[2], +m[3]]
  const n = c.replace('#', '')
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}
/** Near-white: what he sees as a white flower, whatever the exact hex. */
const nearWhite = (c: string) => { const [r, g, b] = rgb(c); return r > 195 && g > 195 && b > 195 }

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

const shores = (s: ReturnType<typeof grow>) => s.props.filter(p => SHORE.includes(p.label ?? ''))

describe('a bank wears the earth the generator serves', () => {
  it('every shore piece takes the served bank colour, on every forest template', () => {
    for (const key of ['forest_jungle', 'forest_jungle_swamp', 'forest_jungle_island', 'forest_woodland', 'forest_meadow']) {
      const bank = findGeneratorByKey(CATALOG, key)!.config.palette?.bank
      expect({ key, bank: bank !== undefined }).toEqual({ key, bank: true }) // a template with water must say what its bank is
      const wrong = shores(grow(key)).filter(p => p.color !== bank).length
      expect({ key, wrong }).toEqual({ key, wrong: 0 })
    }
  })

  it('NOT ONE shore piece is near-white any more, which is the thing he could see', () => {
    for (const key of ['forest_jungle', 'forest_jungle_swamp', 'forest_jungle_island', 'forest_woodland', 'forest_meadow']) {
      for (const zone of ['spring', 'summer', 'autumn', 'winter']) {
        const white = shores(grow(key, zone)).filter(p => nearWhite(p.color)).length
        expect({ key, zone, white }).toEqual({ key, zone, white: 0 })
      }
    }
  })

  it('there are still plenty of them, so this did not pass by deleting the banks', () => {
    // 231 to 450 per map was the measured count. If a "fix" ever empties the set this test says so.
    expect(shores(grow('forest_jungle_swamp')).length).toBeGreaterThan(100)
  })

  it('the tile row itself is no longer authored near-white either', () => {
    for (const label of SHORE) {
      const own = styleTile('ascii', label)?.settings as { color?: string } | undefined
      expect({ label, white: own?.color ? nearWhite(own.color) : false }).toEqual({ label, white: false })
    }
  })
})
