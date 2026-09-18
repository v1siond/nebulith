/**
 * A WAY THE RIVER LANDED ON IS NOT A WAY ANY MORE, except where it crosses.
 *
 * And
 *
 * The pathways are planned on dry ground and the river is carved over them, so a way could come out lying INSIDE
 * the channel for its whole length, and every wet cell of it was planked. Measured before this pass, flat
 * wooden deck cells on one seed: woodland 50, meadow 63, jungle 64. After: 18, 30, 36, with every map still a
 * single walkable island.
 */
import { narrowPathwaysToCrossings } from '@/engine/riverNetwork'

const BOUNDS = { cols: 9, rows: 9 }
const set = (...keys: string[]) => new Set(keys)
/** A river straight down column 4, the full height of the map. */
const RIVER = new Set(Array.from({ length: 9 }, (_, row) => `4,${row}`))

describe('narrowPathwaysToCrossings', () => {
  it('keeps a way that crosses the river, because that is what a crossing is', () => {
    const pathways = set('2,4', '3,4', '4,4', '5,4', '6,4')
    narrowPathwaysToCrossings(BOUNDS, pathways, RIVER)
    expect(pathways.has('4,4')).toBe(true) // the one wet cell IS the crossing
    expect(pathways.size).toBe(5) // and nothing dry was touched
  })

  it('drops a way that runs DOWN the river, which is the causeway', () => {
    // Enters the water at the top, runs down the channel, leaves at the bottom. Same bank both ends.
    const pathways = set('3,1', ...Array.from({ length: 7 }, (_, i) => `4,${i + 1}`), '3,7')
    const dropped = narrowPathwaysToCrossings(BOUNDS, pathways, RIVER)
    expect(dropped).toBeGreaterThan(0)
    const wetLeft = [...pathways].filter(k => RIVER.has(k))
    expect(wetLeft.length).toBeLessThan(7)
  })

  it('still joins both banks when the way both crosses AND runs along', () => {
    // A T: down the channel for six cells, then out the far side.
    const pathways = set('3,1', ...Array.from({ length: 6 }, (_, i) => `4,${i + 1}`), '5,6')
    narrowPathwaysToCrossings(BOUNDS, pathways, RIVER)
    // Whatever it kept has to reach from the left bank cell to the right bank cell through the water.
    const wet = [...pathways].filter(k => RIVER.has(k))
    expect(wet.length).toBeGreaterThan(0)
    expect(pathways.has('3,1')).toBe(true)
    expect(pathways.has('5,6')).toBe(true)
  })

  it('removes a stretch that only ever touches one bank, which is a paddle not a way', () => {
    // A THREE-wide river, so a stretch can sit inside it without reaching the far side. In a one-wide river
    // every wet cell touches both banks, so the paddle case cannot even be written there.
    const wide = new Set<string>()
    for (let row = 0; row < 9; row++) for (const col of [3, 4, 5]) wide.add(`${col},${row}`)
    // Steps in from the left bank, runs down the near half, comes back out to the left bank.
    const pathways = set('2,3', '3,3', '3,4', '3,5', '2,5')
    narrowPathwaysToCrossings(BOUNDS, pathways, wide)
    expect([...pathways].filter(k => wide.has(k))).toEqual([])
    expect(pathways.has('2,3')).toBe(true) // and the dry ends are left alone
    expect(pathways.has('2,5')).toBe(true)
  })

  it('leaves a dry map exactly as it found it', () => {
    const pathways = set('1,1', '2,1', '3,1')
    expect(narrowPathwaysToCrossings(BOUNDS, pathways, new Set())).toBe(0)
    expect(pathways.size).toBe(3)
  })

  it('never touches a cell that is not water', () => {
    const pathways = set('0,4', '1,4', '2,4', '3,4', '4,4', '5,4', '6,4', '7,4', '8,4')
    narrowPathwaysToCrossings(BOUNDS, pathways, RIVER)
    expect([...pathways].filter(k => !RIVER.has(k)).sort()).toEqual(
      ['0,4', '1,4', '2,4', '3,4', '5,4', '6,4', '7,4', '8,4'],
    )
  })
})
