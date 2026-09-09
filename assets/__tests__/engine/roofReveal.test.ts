/**
 * ROOF REVEAL — the Diablo / Path of Exile behaviour.
 *
 * Alexander (2026-09-06, Image #1): "the opacity code is not working correctly either, not transparent enough
 * and is not applied correctly, it should be like diablo likes games, or path of exile, where roof gets
 * transparent when user enters the building and we can see the inside of the thing".
 *
 * The old rule was DISTANCE-based (`cutawayAlpha(dist)`): a roof faded as the hero merely walked NEAR it, which
 * is why the walls ghosted from outside while the roof stayed solid. The rule is now POSITIONAL: the hero is
 * either under a roof or not.
 *
 * A building's roof is many tiles (one z-width block per column), so lifting only the tile directly overhead
 * would punch a HOLE in the roof instead of removing it. `revealedRoofs` therefore takes the CONNECTED roof —
 * every roof block whose footprint touches the one the hero is under — so the whole roof comes off as one.
 */
import { revealedRoofs, revealedShell } from '@/engine/render/roofReveal'

/** A roof block's covered footprint, as the `col,row` keys the grid's rect-coverage produces. */
const foot = (cols: number[], rows: number[]): string[] => cols.flatMap(c => rows.map(r => `${c},${r}`))

describe('revealedRoofs — the roof comes off when the hero is under it, and only then', () => {
  test('hero outside every roof → nothing is revealed', () => {
    const roofs = [foot([5, 6], [5, 6])]
    expect(revealedRoofs(0, 0, roofs)).toEqual(new Set())
  })

  test('hero under a roof → that roof is revealed', () => {
    const roofs = [foot([5, 6], [5, 6])]
    expect(revealedRoofs(5, 6, roofs)).toEqual(new Set([0]))
  })

  test('hero under ONE column of a multi-column roof → the WHOLE connected roof lifts, not just that column', () => {
    // three adjacent z-width roof columns, each spanning the building depth — one building.
    const roofs = [foot([4], [2, 3, 4]), foot([5], [2, 3, 4]), foot([6], [2, 3, 4])]
    expect(revealedRoofs(4, 3, roofs)).toEqual(new Set([0, 1, 2]))
  })

  test('a neighbouring building across the street keeps its roof', () => {
    const mine = [foot([4], [2, 3]), foot([5], [2, 3])]
    const theirs = [foot([9], [2, 3]), foot([10], [2, 3])]
    const roofs = [...mine, ...theirs]
    expect(revealedRoofs(4, 2, roofs)).toEqual(new Set([0, 1]))
  })

  test('a roof block that only touches DIAGONALLY is still the same roof (a corner of an L-shaped building)', () => {
    const roofs = [foot([4], [2, 3]), foot([5], [4, 5])]
    expect(revealedRoofs(4, 2, roofs)).toEqual(new Set([0, 1]))
  })

  test('no roofs at all → nothing is revealed', () => {
    expect(revealedRoofs(3, 3, [])).toEqual(new Set())
  })
})

describe('revealedShell — the walls of the revealed building, so the interior actually reads', () => {
  test('the shell is the revealed roof footprint plus the ring of cells around it (its walls)', () => {
    const roofs = [foot([5], [5])]
    const shell = revealedShell(roofs, new Set([0]))
    expect(shell.has('5,5')).toBe(true)   // under the roof
    expect(shell.has('4,4')).toBe(true)   // the wall ring
    expect(shell.has('6,6')).toBe(true)
    expect(shell.has('7,5')).toBe(false)  // two cells out — a neighbour's wall, left alone
  })

  test('nothing revealed → an empty shell, so no tile fades', () => {
    expect(revealedShell([foot([5], [5])], new Set())).toEqual(new Set())
  })
})
