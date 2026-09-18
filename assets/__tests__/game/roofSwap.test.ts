/**
 * A LOOK LAYS ITS OWN ROOF.
 *
 * The roof SHAPE is baked into each composition, so a palette that carries only colours can never change one.
 * `roofSwap` is the whole of the fix: a roof cell's label becomes the roof the look named, and because a roof
 * is a body plus a ridge cap, the cap has to move with it or a gable ridge ends up sitting on a flat deck.
 */
import { flattenedRoof, roofSwap } from '@/game/runtime/composition'

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

  /**
   * THIS USED TO ASSERT THE BUG.
   *
   * It returned null, the stamp reads null as "do not lay this cell", and `gable_roof` labels the PEAK columns
   * with the cap. So every gabled building in a flat-roof city lost its ridge columns and came out with a hole
   * down the middle of its deck. The ridge is meaningless on a flat roof; the CELL is not.
   */
  it('turns the ridge into deck on a flat roof, never into a hole', () => {
    expect(roofSwap('roof_top', 'flat_roof')).toBe('flat_roof')
    expect(roofSwap('roof_top_slate', 'flat_roof')).toBe('flat_roof')
  })

  it('never returns null, because a dropped cell is a hole', () => {
    for (const label of ['roof', 'roof_slate', 'roof_top', 'roof_top_slate', 'flat_roof']) {
      for (const roof of ['roof', 'roof_slate', 'flat_roof']) {
        expect(roofSwap(label, roof)).not.toBeNull()
      }
    }
  })

  describe('flattenedRoof: a pitch laid flat loses its pitch', () => {
    it('is true for any roof piece going onto a flat deck', () => {
      expect(flattenedRoof('roof', 'flat_roof')).toBe(true)
      expect(flattenedRoof('roof_top', 'flat_roof')).toBe(true)
      expect(flattenedRoof('roof_slate', 'flat_roof')).toBe(true)
      expect(flattenedRoof('roof_top_slate', 'flat_roof')).toBe(true)
    })

    it('is false when the look lays a pitched roof, which keeps its steps', () => {
      expect(flattenedRoof('roof', 'roof_slate')).toBe(false)
      expect(flattenedRoof('roof_top', 'roof')).toBe(false)
    })

    it('is false for anything that is not a roof', () => {
      expect(flattenedRoof('wall_wood_c', 'flat_roof')).toBe(false)
      expect(flattenedRoof('window', 'flat_roof')).toBe(false)
      expect(flattenedRoof('roof_store', 'flat_roof')).toBe(false) // a store keeps its own identity
    })
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
