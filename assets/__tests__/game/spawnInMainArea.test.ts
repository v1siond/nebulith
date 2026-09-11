/**
 * The player always lands where they can walk — Alexander, 2026-09-11: *"make sure the player is always in a
 * zone we can walk when generating a new map ... I'm stuck and cant go anywhere"*.
 */
import { spawnInMainArea } from '@/game/runtime/spawn'

/** Build a predicate from a picture: '.' open, '#' blocked. */
const map = (rows: string[]) => ({
  cols: rows[0].length,
  rows: rows.length,
  isOpen: (c: number, r: number) => rows[r]?.[c] === '.',
})

describe('spawnInMainArea', () => {
  it('keeps the intended cell when it is already in the main area', () => {
    const m = map(['.....', '.....', '.....'])
    expect(spawnInMainArea(m.isOpen, m.cols, m.rows, { col: 2, row: 1 })).toEqual({ col: 2, row: 1 })
  })

  it('moves a spawn OUT of a one-cell pocket into the big area — the stuck case', () => {
    // The pocket at (1,1) is open and passes a single-cell check, and it leads nowhere.
    const m = map([
      '###.......',
      '#.#.......',
      '###.......',
    ])
    const spawn = spawnInMainArea(m.isOpen, m.cols, m.rows, { col: 1, row: 1 })
    expect(spawn).not.toEqual({ col: 1, row: 1 })
    expect(spawn!.col).toBeGreaterThanOrEqual(3)
  })

  it('counts a DIAGONAL-only touch as a different place — the body cannot fit through a corner gap', () => {
    // The three-cell area top-left touches the big area only at a corner; the big one wins.
    const m = map([
      '..#.......',
      '..#.......',
      '##........',
    ])
    const spawn = spawnInMainArea(m.isOpen, m.cols, m.rows, { col: 0, row: 0 })
    expect(spawn!.col).toBeGreaterThanOrEqual(2)
  })

  it('lands as close to the intended cell as the main area allows', () => {
    const m = map([
      '.........',
      '.#######.',
      '.#.....#.',
      '.#######.',
      '.........',
    ])
    // Target sits in the sealed middle room (5 cells); the ring around it (24 cells) is the main area.
    expect(spawnInMainArea(m.isOpen, m.cols, m.rows, { col: 4, row: 2 })).toEqual({ col: 4, row: 0 })
  })

  it('a blocked or out-of-bounds target still gets a real cell', () => {
    const m = map(['#....', '.....'])
    expect(m.isOpen(...Object.values(spawnInMainArea(m.isOpen, m.cols, m.rows, { col: 0, row: 0 })!) as [number, number])).toBe(true)
    expect(spawnInMainArea(m.isOpen, m.cols, m.rows, { col: 99, row: -4 })).not.toBeNull()
  })

  it('a map with nowhere to stand answers null rather than inventing a cell', () => {
    const m = map(['###', '###'])
    expect(spawnInMainArea(m.isOpen, m.cols, m.rows, { col: 1, row: 1 })).toBeNull()
  })
})
