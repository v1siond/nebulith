/**
 * LEVEL ORDER — the ordered template ids that make a game's levels.
 *
 * This is what survives the deletion of the localStorage Game model (§3.14b #18, §3.1). The MODEL
 * is the backend's now (`/api/games` owns identity, names and membership); what stays in the
 * frontend is the pure ordering a user performs before the list is PUT back. So these functions
 * take a plain `string[]` and never mint an id or invent a Game — there is exactly one Game model.
 */
import { levelTemplateId, moveLevel, removeLevel } from '@/game/levelOrder'

const IDS = ['a', 'b', 'c']

describe('moveLevel', () => {
  it('moves a level up', () => {
    expect(moveLevel(IDS, 2, 1)).toEqual(['a', 'c', 'b'])
  })

  it('moves a level down', () => {
    expect(moveLevel(IDS, 0, 2)).toEqual(['b', 'c', 'a'])
  })

  it('never mutates the input', () => {
    const input = [...IDS]
    moveLevel(input, 0, 2)
    expect(input).toEqual(IDS)
  })

  it.each([
    ['a negative source', -1, 1],
    ['a source past the end', 3, 1],
    ['a negative target', 0, -1],
    ['a target past the end', 0, 3],
    ['a move to itself', 1, 1],
  ])('leaves the order alone for %s', (_label, from, to) => {
    expect(moveLevel(IDS, from, to)).toEqual(IDS)
  })

  it('keeps duplicates — the same template may appear at two levels', () => {
    expect(moveLevel(['a', 'a', 'b'], 2, 0)).toEqual(['b', 'a', 'a'])
  })
})

describe('removeLevel', () => {
  it('removes by index, not by id, so a repeated template loses only the one clicked', () => {
    expect(removeLevel(['a', 'b', 'a'], 0)).toEqual(['b', 'a'])
  })

  it('leaves the list alone when the index is out of range', () => {
    expect(removeLevel(IDS, 9)).toEqual(IDS)
    expect(removeLevel(IDS, -1)).toEqual(IDS)
  })

  it('never mutates the input', () => {
    const input = [...IDS]
    removeLevel(input, 1)
    expect(input).toEqual(IDS)
  })
})

describe('levelTemplateId', () => {
  it('is 1-based — level 1 is the first template', () => {
    expect(levelTemplateId(IDS, 1)).toBe('a')
    expect(levelTemplateId(IDS, 3)).toBe('c')
  })

  it('returns undefined outside the level range', () => {
    expect(levelTemplateId(IDS, 0)).toBeUndefined()
    expect(levelTemplateId(IDS, 4)).toBeUndefined()
    expect(levelTemplateId([], 1)).toBeUndefined()
  })
})
