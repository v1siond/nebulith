/**
 * A LOOK LAYS ITS OWN ROOF.
 *
 * Alexander, 2026-09-11: *"I picked a tropical city and had nothing different than a regular one ... the
 * material of houses should be different, walls different, roof different"*.
 *
 * The roof SHAPE is baked into each composition, so a palette that carries only colours can never change one.
 * `roofSwap` is the whole of the fix: a roof cell's label becomes the roof the look named, and because a roof
 * is a body plus a ridge cap, the cap has to move with it or a gable ridge ends up sitting on a flat deck.
 */
import { roofSwap } from '@/game/runtime/composition'

describe('roofSwap', () => {
  it('leaves everything alone when the look names no roof', () => {
    expect(roofSwap('roof', undefined)).toBeUndefined()
    expect(roofSwap('roof_top', undefined)).toBeUndefined()
    expect(roofSwap('wall_wood_c', undefined)).toBeUndefined()
  })

  it('swaps the body to the roof the look named', () => {
    expect(roofSwap('roof', 'roof_slate')).toBe('roof_slate')
    expect(roofSwap('roof_slate', 'roof')).toBe('roof')
    expect(roofSwap('roof', 'flat_roof')).toBe('flat_roof')
  })

  it('moves the CAP with the body, so a slate ridge never sits on a gable', () => {
    expect(roofSwap('roof_top', 'roof_slate')).toBe('roof_top_slate')
    expect(roofSwap('roof_top_slate', 'roof')).toBe('roof_top')
  })

  it('drops the ridge entirely on a flat deck', () => {
    expect(roofSwap('roof_top', 'flat_roof')).toBeNull()
    expect(roofSwap('roof_top_slate', 'flat_roof')).toBeNull()
  })

  it('never touches a store or a hospital roof: those two keep their identity', () => {
    expect(roofSwap('roof_store', 'roof_slate')).toBeUndefined()
    expect(roofSwap('roof_hospital', 'flat_roof')).toBeUndefined()
    expect(roofSwap('roof_top_store', 'roof_slate')).toBeUndefined()
    expect(roofSwap('roof_top_hospital', 'roof')).toBeUndefined()
  })

  it('ignores a roof the catalog does not know how to lay', () => {
    expect(roofSwap('roof', 'roof_thatch')).toBeUndefined() // not authored yet, so nothing changes
    expect(roofSwap('wall_stone_c', 'roof_slate')).toBeUndefined()
  })
})
