/**
 * A WAY NEVER OVERWRITES WATER. IT IS CUT THERE, OR IT CROSSES ON A BRIDGE.
 *
 * *"the real issue is that we were putting streets over the water sections, pathways DON'T overwrite water
 * sections, with the exception of bridges, which mean, if a pathway is intersected by a river for example,
 * then it's either cut, or it continues with a bridge (any of the types)"*.
 *
 * A settlement carved its water first and then paved its streets over the top of it, because the street
 * paver wrote `FLAT_FLOOR` into every cell `layout.roads` claimed and asked nothing about what was already
 * there. So a town's grid ran straight across the channel and the river read as a road with a blue stripe
 * under it. The forest paver has skipped water since it got rivers (`wearTheWay`); the settlement one never
 * did, and both draw the same kind of way.
 *
 * *"you must think of every map as if they were a real location in the real world"*: a street stops at the
 * bank. What carries it over is a bridge, and a bridge is an object the next phase lays.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { isWaterGround } from '@/engine/riverNetwork'
import { FLAT_FLOOR, generateStage, type StageData } from '@/engine/stageGenerator'
import { findGeneratorForVariant } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import { SERVED_CATALOG } from '@/__tests__/helpers/servedGenerator'

const COLS = 50
const ROWS = 50

/** A settlement built from its served row, with a river running through it. */
function town(variant: 'town' | 'city', seed: number): StageData {
  const config = findGeneratorForVariant(SERVED_CATALOG, variant, variant)?.config
  if (!config) throw new Error(`the catalog serves no ${variant}`)
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant, layout: variant as never, cols: COLS, rows: ROWS,
      options: { exits: '2', pathways: '3', river: 'through', crossing: true },
      nature: config.nature, palette: config.palette, settlement: config.settlement,
      formation: config.formation, treeMix: config.trees, subZones: config.subZones,
      terrain: config.terrain, regionLayout: config.regionLayout, pathway: config.pathway,
      crossings: config.crossings,
    })
  } finally {
    Math.random = orig
  }
}

/**
 * Every cell the WATER PASS claimed, which is not the same question as which cells still look wet.
 *
 * Asking the ground label cannot catch this defect: the paver that writes over a water cell also erases the
 * evidence that it was one, so "is any water cell paved" comes back zero on the broken map for the same
 * reason it comes back zero on the fixed one. That is the degenerate oracle this suite exists to avoid.
 */
const waterCells = (s: StageData): Array<[number, number]> =>
  [...(s.water ?? [])].map(key => key.split(',').map(Number) as [number, number])

describe('a settlement paves up to the water and stops', () => {
  it.each([1, 5, 9])('a town at seed %i has a river, and not one cell of it was paved over', seed => {
    const s = town('town', seed)
    const water = waterCells(s)
    expect(water.length).toBeGreaterThan(0) // a map with no river proves nothing about paving one

    // THE PAVED CELL IS THE EMPTY ONE. A street writes `FLAT_FLOOR`, the colour-only tile, so a water cell
    // wearing it is a cell the paver took. Asking the ground is asking what is on screen.
    const paved = water.filter(([c, r]) => s.ground[r][c] === FLAT_FLOOR)
    expect({ seed, paved: paved.length }).toEqual({ seed, paved: 0 })
  })

  it('a city does the same, and a city is the one with four-wide streets', () => {
    const s = town('city', 3)
    const water = waterCells(s)
    expect(water.length).toBeGreaterThan(0)
    expect(water.filter(([c, r]) => s.ground[r][c] === FLAT_FLOOR)).toEqual([])
  })

  it('and the way still gets across: where it meets the river there is a deck or a ford', () => {
    // CUT OR BRIDGED, never painted through. A town that asked to be crossed gets the span; what must never
    // happen is the third thing, a street drawn over open water with nothing holding it up.
    const s = town('town', 1)
    const crossing = new Set<string>([...(s.decks ?? []), ...(s.fords ?? [])])
    expect(crossing.size).toBeGreaterThan(0)

    // A deck stands ON the water it crosses, which is what tells it from a street that ignored the river.
    const onWater = [...crossing].filter(key => {
      const [c, r] = key.split(',').map(Number)
      return isWaterGround(s.ground[r][c]) || s.wet?.has(key)
    })
    expect(onWater.length).toBeGreaterThan(0)
  })
})
