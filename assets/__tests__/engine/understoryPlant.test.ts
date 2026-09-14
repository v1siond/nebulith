/**
 * WHAT GROWS ON THE FLOOR, AND WHETHER YOU CAN WALK ON IT.
 *
 * Measured against the live catalog: of the 40 tiles in the `nature` category, `thicket` is the ONLY one that
 * blocks. Everything else, flowers and clover and mushrooms included, is walkable. And `plantUndergrowth`
 * could plant nothing but the thicket, so every forest template from the meadow up grew waist-high walls
 * wearing a plant picture.
 *
 * The formations are named after his own reference images, and three of the five say in their own notes that
 * the floor is clear: "nothing between them" (#10), "a clear walkable floor" (#11), "clear ground between the
 * groups" (#12). Only #14 and #15 describe a floor you cannot cross. So the plant is served per formation,
 * and whether it blocks is the TILE's business, read off its row rather than minted here.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import { findGeneratorByKey, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

/** Build a template from its REAL served config, exactly as the editor does. */
function grow(key: string, seed = 3) {
  const gen = findGeneratorByKey(CATALOG, key)
  if (!gen) throw new Error(`no served generator ${key}`)
  const c = gen.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout: gen.layout as 'woodland' | 'jungle' | 'meadow',
      cols: 60, rows: 40,
      nature: c.nature, palette: c.palette, formation: c.formation,
      treeMix: c.trees, subZones: c.subZones, crossings: c.crossings,
    })
  } finally { Math.random = orig }
}

const plants = (s: ReturnType<typeof grow>, label: string) => s.props.filter(p => p.label === label)
/** Every cell holding this plant, and whether the generator blocked it. */
const blockedUnder = (s: ReturnType<typeof grow>, label: string) =>
  plants(s, label).filter(p => s.collision[p.row][p.col]).length

describe('the understory is the plant the backend serves', () => {
  it('a plain woodland grows walkable ground cover, and you can stand on every cell of it', () => {
    const wood = grow('forest_woodland')
    const grass = plants(wood, 'tall_grass')
    expect(grass.length).toBeGreaterThan(0)
    expect(blockedUnder(wood, 'tall_grass')).toBe(0)
  })

  it('a plain woodland grows no thicket at all, which is the complaint itself', () => {
    expect(plants(grow('forest_woodland'), 'thicket')).toHaveLength(0)
  })

  it('a meadow grows nothing you cannot walk over', () => {
    const meadow = grow('forest_meadow')
    expect(plants(meadow, 'thicket')).toHaveLength(0)
    expect(blockedUnder(meadow, 'tall_grass')).toBe(0)
  })

  it('a JUNGLE still chokes, because its formation serves the thicket', () => {
    const jungle = grow('forest_jungle')
    const thicket = plants(jungle, 'thicket')
    expect(thicket.length).toBeGreaterThan(0)
    // Every one of them blocks, and the generator did not decide that: the tile row did.
    expect(blockedUnder(jungle, 'thicket')).toBe(thicket.length)
  })

  it('a DENSE woodland still chokes too, which is his image #15', () => {
    const dense = grow('forest_woodland_dense')
    const thicket = plants(dense, 'thicket')
    expect(thicket.length).toBeGreaterThan(0)
    expect(blockedUnder(dense, 'thicket')).toBe(thicket.length)
  })

  it('a REGION inside a woodland inherits its plant, it does not fall back to the thicket', () => {
    // All 19 served sub-zone formations state an `understory` number and none states a tile. Reading only the
    // region's own dropped a glade and a mountain vale straight back onto the blocking thicket: 29 of them on
    // one glades seed, measured.
    for (const key of ['forest_woodland_glades', 'forest_woodland_mountain']) {
      expect({ key, thickets: plants(grow(key), 'thicket').length }).toEqual({ key, thickets: 0 })
    }
  })

  it('every served forest template names the plant its understory is made of', () => {
    // A formation with an understory and no tile falls back to the thicket, so a gap here is an invisible
    // wall on that template. Assert the DATA rather than the map it happens to produce.
    const keys = ['forest_woodland', 'forest_woodland_beech', 'forest_woodland_dense', 'forest_woodland_glades',
      'forest_woodland_mountain', 'forest_meadow', 'forest_meadow_open', 'forest_meadow_pasture',
      'forest_jungle', 'forest_jungle_dense', 'forest_jungle_swamp', 'forest_jungle_island', 'forest_jungle_ruins']
    const missing = keys.filter(k => {
      const f = findGeneratorByKey(CATALOG, k)?.config.formation
      return f?.understory !== undefined && f.understoryTile === undefined
    })
    expect(missing).toEqual([])
  })
})
