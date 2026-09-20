/**
 * WHAT GROWS ON THE FLOOR, AND WHETHER YOU CAN WALK ON IT.
 *
 * Measured against the live catalog: of the 40 tiles in the `nature` category, `thicket` is the ONLY one that
 * blocks. Everything else, flowers and clover and mushrooms included, is walkable. And `plantUndergrowth`
 * could plant nothing but the thicket, so every wilderness row from the meadow up grew waist-high walls
 * wearing a plant picture.
 *
 * A row is found by its KEY. A type is an ENVIRONMENT now and the nine wilderness rows share three engine
 * builders between them, so the builder names the pass to run and never the row.
 *
 * The formations are named after the own reference images, and three of the five say in their own notes that
 * the floor is clear: "nothing between them" (#10), "a clear walkable floor" (#11), "clear ground between the
 * groups" (#12). Only #14 and #15 describe a floor you cannot cross. So the plant is served per formation,
 * and whether it blocks is the TILE's business, read off its row rather than minted here.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import { findGeneratorByKey, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import { servedConfig } from '@/__tests__/helpers/servedGenerator'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

/** Every wilderness row the backend serves, so this file never keeps a list of them. */
const wilderness = () => CATALOG.find(c => c.key === 'wilderness')?.generators ?? []

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
      // …and how much of what the map holds, which is what the understory planter measures itself against.
      terrain: c.terrain, regionLayout: c.regionLayout,
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
    // THE TITLE IS THE RULE, and it is about walking, not about one label. This asserted zero THICKETS,
    // from back when the thicket was the one plant row that blocked. It is not any more: *"the density of
    // trees is conflicting with the functionality of the map, user can't move, we can't put any treasures
    // nor units around"*, so `ensure_ground_plants/0` writes `occupies: false` on all nineteen of them. A
    // meadow's `hedgerow` is a thicket by definition, and you walk through a hedgerow.
    const meadow = grow('forest_meadow')
    const grown = meadow.props.filter(p => p.grows)
    expect(grown.length).toBeGreaterThan(0)
    // A CELL THAT HOLDS ONLY THE PLANT. A trunk may stand in the same cell and a trunk blocks; what must
    // never happen is a cell you cannot walk into whose only contents are something you walk through.
    const trunks = new Set(meadow.trees.map(t => `${t.col},${t.row}`))
    const blocked = grown.filter(p => meadow.collision[p.row][p.col] && !trunks.has(`${p.col},${p.row}`))
    expect(blocked.map(p => `${p.label}@${p.col},${p.row}`)).toEqual([])
  })

  it('a JUNGLE still chokes, and it chokes where its own regions say it does', () => {
    const jungle = grow('forest_jungle')
    const thicket = plants(jungle, 'thicket')
    expect(thicket.length).toBeGreaterThan(0)

    // …and not one of them stops you on its own, which is the other half. A jungle is thick, not sealed.
    const trunks = new Set(jungle.trees.map(t => `${t.col},${t.row}`))
    const sealed = thicket.filter(p => jungle.collision[p.row][p.col] && !trunks.has(`${p.col},${p.row}`))
    expect(sealed.map(p => `${p.col},${p.row}`)).toEqual([])

    // WHERE it is thick is the region's business: the `understory` is the wall of bush, the `emergent` is
    // the open dark floor under the giants. A count over the whole map cannot tell those apart.
    const inRegion = (key: string) =>
      thicket.filter(p => jungle.regions?.[p.row]?.[p.col] === key).length
    expect(inRegion('understory')).toBeGreaterThan(inRegion('emergent'))
  })

  it('a REGION inside a wood grows ITS OWN plant, never one the template fell back to', () => {
    // Reading only the region's own used to drop a glade and a mountain vale onto the thicket, 29 of them
    // on one woodland seed. The rule is that a region's plant is the one its own data names, so the check
    // is against the SERVED set rather than against one label being absent: a mountain's `foot` is a
    // thicketed lower slope on purpose, and asserting "no thicket anywhere" called that a defect.
    for (const key of ['forest_woodland', 'forest_mountain']) {
      const stage = grow(key)
      const config = servedConfig('wilderness', key)
      // The regions' plants, PLUS the template's own: a cell no region claims grows what the row states,
      // which is the documented inheritance rather than a fallback.
      const served = new Set(
        [
          config.formation?.understoryTile,
          ...(config.subZones ?? []).map(z => z.formation?.understoryTile),
        ].filter((t): t is string => !!t),
      )
      expect(served.size).toBeGreaterThan(1)
      // UNDERSTORY PLANTS ONLY. A bloom is not an understory: it comes from `nature.flowers` and is the
      // subject of its own cases, so counting it here asked this one a question it was not about.
      const understories = new Set(
        wilderness().flatMap(g => [
          g.config.formation?.understoryTile,
          ...(g.config.subZones ?? []).map(z => z.formation?.understoryTile),
        ]).filter((t): t is string => !!t),
      )
      const strangers = stage.props
        .filter(p => p.grows && p.label && understories.has(p.label) && !served.has(p.label))
        .map(p => p.label)
      expect({ key, strangers: [...new Set(strangers)] }).toEqual({ key, strangers: [] })
    }
  })

  it('every served wilderness row names the plant its understory is made of', () => {
    // A formation with an understory and no tile falls back to the thicket, so a gap here is an invisible
    // wall on that template. Assert the DATA rather than the map it happens to produce, and walk the rows the
    // backend actually serves so a new environment is covered the day it is seeded.
    const missing = wilderness().filter(g => {
      const f = g.config.formation
      return f?.understory !== undefined && f.understoryTile === undefined
    }).map(g => g.key)
    expect(missing).toEqual([])
  })
})
