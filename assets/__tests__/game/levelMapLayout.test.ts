/**
 * THE LEVEL MAP places levels where their DOORWAYS say they are.
 *
 * Alexander, 2026-09-08: *"while we do have a connection of all levels, it's not formed into a real map
 * layout."* The old layout put every level on a circle by array index — the edges were right, the
 * positions meant nothing. These tests are about the positions, because that is the entire change.
 */
import {
  doorDirection,
  layoutBounds,
  layoutLevels,
  type LevelNode,
} from '@/game/editor/levelMapLayout'

/** A 20×20 level with the given doors. */
const level = (id: string, doors: LevelNode['doors'] = []): LevelNode => ({ id, name: id, cols: 20, rows: 20, doors })
const door = (targetId: string, ...cells: [number, number][]) => ({
  targetId,
  cells: cells.map(([col, row]) => ({ col, row })),
})
const at = (placed: ReturnType<typeof layoutLevels>, id: string) => placed.find(p => p.id === id)

describe('which edge a doorway sits on', () => {
  it.each([
    ['west', [0, 10]],
    ['east', [19, 10]],
    ['north', [10, 0]],
    ['south', [10, 19]],
  ] as const)('reads a doorway at %s', (expected, [col, row]) => {
    expect(doorDirection(door('b', [col, row]), 20, 20)).toBe(expected)
  })

  it('judges a WIDE doorway by its centre, not its first cell', () => {
    // A gate spanning the whole south wall: its first cell is hard against the west edge, but the gate is
    // southern. Reading cells[0] would call this "west".
    const gate = door('b', [0, 19], [1, 19], [2, 19], [3, 19], [4, 19])
    expect(doorDirection(gate, 20, 20)).toBe('south')
  })

  it('returns null for a doorway with no cells rather than guessing a direction', () => {
    expect(doorDirection(door('b'), 20, 20)).toBeNull()
  })
})

describe('levels land in the direction their doorway pointed', () => {
  it('puts the level through an EAST door to the east', () => {
    const placed = layoutLevels([level('a', [door('b', [19, 10])]), level('b')], 'a')
    expect(at(placed, 'a')).toMatchObject({ gx: 0, gy: 0 })
    expect(at(placed, 'b')).toMatchObject({ gx: 1, gy: 0 })
  })

  it('puts a NORTH door UP — negative y, the screen convention', () => {
    const placed = layoutLevels([level('a', [door('b', [10, 0])]), level('b')], 'a')
    expect(at(placed, 'b')).toMatchObject({ gx: 0, gy: -1 })
  })

  it('walks two doors deep, each step from its own parent', () => {
    const placed = layoutLevels([
      level('a', [door('b', [19, 10])]),
      level('b', [door('c', [10, 19])]),
      level('c'),
    ], 'a')
    expect(at(placed, 'b')).toMatchObject({ gx: 1, gy: 0 })
    expect(at(placed, 'c')).toMatchObject({ gx: 1, gy: 1 }) // east of a, then south of b
  })

  it('starts from the level you are STANDING IN, not the first in the list', () => {
    const placed = layoutLevels([level('a', [door('b', [19, 10])]), level('b', [door('a', [0, 10])])], 'b')
    expect(at(placed, 'b')).toMatchObject({ gx: 0, gy: 0 })
    expect(at(placed, 'a')).toMatchObject({ gx: -1, gy: 0 }) // west of b, from b's own west door
  })
})

describe('the cases the naive version gets wrong', () => {
  it('never stacks two levels on one slot', () => {
    // Both doors point east. The second cannot have (1,0) too.
    const placed = layoutLevels([
      level('a', [door('b', [19, 8]), door('c', [19, 12])]),
      level('b'),
      level('c'),
    ], 'a')
    const slots = placed.map(p => `${p.gx},${p.gy}`)
    expect(new Set(slots).size).toBe(slots.length)
    // …and the displaced one stays adjacent to where it wanted to be.
    const c = at(placed, 'c')!
    expect(Math.max(Math.abs(c.gx - 1), Math.abs(c.gy - 0))).toBeLessThanOrEqual(1)
  })

  it('marks a level nothing connects to as unconnected instead of inventing a position', () => {
    const placed = layoutLevels([level('a', [door('b', [19, 10])]), level('b'), level('orphan')], 'a')
    expect(at(placed, 'orphan')?.connected).toBe(false)
    expect(at(placed, 'a')?.connected).toBe(true)
    expect(at(placed, 'b')?.connected).toBe(true)
  })

  it('puts the unconnected levels BELOW the map, clear of it', () => {
    const placed = layoutLevels([level('a', [door('b', [10, 19])]), level('b'), level('orphan')], 'a')
    const lowestConnected = Math.max(...placed.filter(p => p.connected).map(p => p.gy))
    expect(at(placed, 'orphan')!.gy).toBeGreaterThan(lowestConnected)
  })

  it('ignores a doorway to a level that no longer exists', () => {
    const placed = layoutLevels([level('a', [door('deleted', [19, 10])])], 'a')
    expect(placed).toHaveLength(1)
    expect(at(placed, 'a')).toMatchObject({ gx: 0, gy: 0 })
  })

  it('does not loop forever on a cycle', () => {
    const placed = layoutLevels([
      level('a', [door('b', [19, 10])]),
      level('b', [door('a', [0, 10])]),
    ], 'a')
    expect(placed).toHaveLength(2)
  })

  it('handles a single level, and an empty list', () => {
    expect(layoutLevels([level('a')], 'a')).toHaveLength(1)
    expect(layoutLevels([], 'a')).toEqual([])
  })

  it('falls back to the first level when the origin id is not in the list', () => {
    const placed = layoutLevels([level('a'), level('b')], 'nope')
    expect(at(placed, 'a')).toMatchObject({ gx: 0, gy: 0 })
  })
})

describe('bounds, so a view can fit the whole map', () => {
  it('spans every placed level', () => {
    const placed = layoutLevels([
      level('a', [door('b', [19, 10]), door('c', [0, 10])]),
      level('b'),
      level('c'),
    ], 'a')
    expect(layoutBounds(placed)).toMatchObject({ minX: -1, maxX: 1 })
  })

  it('is all-zero for an empty map rather than NaN or Infinity', () => {
    expect(layoutBounds([])).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 })
  })
})
