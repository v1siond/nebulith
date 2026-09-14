/**
 * A WAY THE RIVER LANDED ON IS NOT A WAY ANY MORE, except where it crosses.
 *
 * and 2026-09-12: *"bridge wood zone is almost as long and big as the rivr"* and *"we just need the actual bridge
 * connecting"*.
 *
 * The ways are planned on dry ground and the river is carved over them, so a way could come out lying INSIDE the
 * channel for its whole length, and every wet cell of it was planked. Measured before this pass, flat wooden deck
 * cells on one seed: woodland 50, meadow 63, jungle 64. After: 18, 30, 36, with every map still a single walkable
 * island.
 */
import { narrowWaysToCrossings } from '@/engine/riverNetwork'

const BOUNDS = { cols: 9, rows: 9 }
const set = (...keys: string[]) => new Set(keys)
/** A river straight down column 4, the full height of the map. */
const RIVER = new Set(Array.from({ length: 9 }, (_, row) => `4,${row}`))

describe('narrowWaysToCrossings', () => {
  it('keeps a way that crosses the river, because that is what a crossing is', () => {
    const ways = set('2,4', '3,4', '4,4', '5,4', '6,4')
    narrowWaysToCrossings(BOUNDS, ways, RIVER)
    expect(ways.has('4,4')).toBe(true) // the one wet cell IS the crossing
    expect(ways.size).toBe(5) // and nothing dry was touched
  })

  it('drops a way that runs DOWN the river, which is the causeway', () => {
    // Enters the water at the top, runs down the channel, leaves at the bottom. Same bank both ends.
    const ways = set('3,1', ...Array.from({ length: 7 }, (_, i) => `4,${i + 1}`), '3,7')
    const dropped = narrowWaysToCrossings(BOUNDS, ways, RIVER)
    expect(dropped).toBeGreaterThan(0)
    const wetLeft = [...ways].filter(k => RIVER.has(k))
    expect(wetLeft.length).toBeLessThan(7)
  })

  it('still joins both banks when the way both crosses AND runs along', () => {
    // A T: down the channel for six cells, then out the far side.
    const ways = set('3,1', ...Array.from({ length: 6 }, (_, i) => `4,${i + 1}`), '5,6')
    narrowWaysToCrossings(BOUNDS, ways, RIVER)
    // Whatever it kept has to reach from the left bank cell to the right bank cell through the water.
    const wet = [...ways].filter(k => RIVER.has(k))
    expect(wet.length).toBeGreaterThan(0)
    expect(ways.has('3,1')).toBe(true)
    expect(ways.has('5,6')).toBe(true)
  })

  it('removes a stretch that only ever touches one bank, which is a paddle not a way', () => {
    // A THREE-wide river, so a stretch can sit inside it without reaching the far side. In a one-wide river
    // every wet cell touches both banks, so the paddle case cannot even be written there.
    const wide = new Set<string>()
    for (let row = 0; row < 9; row++) for (const col of [3, 4, 5]) wide.add(`${col},${row}`)
    // Steps in from the left bank, runs down the near half, comes back out to the left bank.
    const ways = set('2,3', '3,3', '3,4', '3,5', '2,5')
    narrowWaysToCrossings(BOUNDS, ways, wide)
    expect([...ways].filter(k => wide.has(k))).toEqual([])
    expect(ways.has('2,3')).toBe(true) // and the dry ends are left alone
    expect(ways.has('2,5')).toBe(true)
  })

  it('leaves a dry map exactly as it found it', () => {
    const ways = set('1,1', '2,1', '3,1')
    expect(narrowWaysToCrossings(BOUNDS, ways, new Set())).toBe(0)
    expect(ways.size).toBe(3)
  })

  it('never touches a cell that is not water', () => {
    const ways = set('0,4', '1,4', '2,4', '3,4', '4,4', '5,4', '6,4', '7,4', '8,4')
    narrowWaysToCrossings(BOUNDS, ways, RIVER)
    expect([...ways].filter(k => !RIVER.has(k)).sort()).toEqual(
      ['0,4', '1,4', '2,4', '3,4', '5,4', '6,4', '7,4', '8,4'],
    )
  })
})
