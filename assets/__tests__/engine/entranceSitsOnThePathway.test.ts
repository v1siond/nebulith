/**
 * AN ENTRANCE STANDS IN THE MIDDLE OF THE PATHWAY IT MARKS.
 *
 * *"please make sure the proposal is located in the actual cetner of the pathway"* (2026-09-14).
 *
 * A composition's anchor is its TOP-LEFT, and `stampEntrances` placed the anchor ON the gate's middle cell,
 * with a comment claiming the entrance was "authored around its own middle cell". It is not: a 3-wide entrance
 * anchored at the middle ran from the middle outward and finished a cell past the pathway, so every gate wore
 * its entrance one cell to the side. A 5-wide cave mouth is two cells off.
 *
 * The cell that has to land on the middle of the pathway is the MOUTH: the middle of the authored front edge.
 * These cases pin that for every footprint width and every side a gate can be on, because the rotation is what
 * makes it easy to get right in one direction and wrong in the other three.
 */
import { rotateFootprintOffset } from '@/engine/buildingCatalog'

/** The anchor `stampEntrances` computes, in the same terms: middle of the gate, minus the rotated mouth. */
function anchorFor(foot: { w: number; h: number }, middle: { col: number; row: number }, rotation: number): { col: number; row: number } {
  const mouth = rotateFootprintOffset(Math.floor((foot.w - 1) / 2), 0, foot.w, foot.h, rotation)
  return { col: middle.col - mouth.dx, row: middle.row - mouth.dy }
}

/** Where the mouth ACTUALLY lands once the composition is stamped at that anchor with that rotation. */
function mouthCell(foot: { w: number; h: number }, anchor: { col: number; row: number }, rotation: number): { col: number; row: number } {
  const o = rotateFootprintOffset(Math.floor((foot.w - 1) / 2), 0, foot.w, foot.h, rotation)
  return { col: anchor.col + o.dx, row: anchor.row + o.dy }
}

// south, west, north, east, the four ENTRANCE_TURN values, in order.
const ROTATIONS = [0, 1, 2, 3]
const FOOTPRINTS = [
  { w: 1, h: 1 },
  { w: 3, h: 2 }, // the authored entrance before the cave
  { w: 5, h: 3 }, // the cave mound
  { w: 4, h: 3 }, // an even width, where "the middle" has to pick a side and stay consistent
]

describe('the mouth lands on the middle of the pathway', () => {
  for (const foot of FOOTPRINTS) {
    for (const rotation of ROTATIONS) {
      it(`${foot.w}x${foot.h} at rotation ${rotation}`, () => {
        const middle = { col: 20, row: 7 }
        expect(mouthCell(foot, anchorFor(foot, middle, rotation), rotation)).toEqual(middle)
      })
    }
  }
})

describe('what the old placement did', () => {
  it('put a 3-wide entrance a cell off the pathway, and a 5-wide two cells off', () => {
    const middle = { col: 20, row: 7 }
    // The old code used the gate middle AS the anchor. The mouth then lands that far past it.
    for (const [foot, off] of [[{ w: 3, h: 2 }, 1], [{ w: 5, h: 3 }, 2]] as const) {
      const landed = mouthCell(foot, middle, 0)
      expect(landed.col - middle.col).toBe(off)
    }
  })

  it('and a 1-wide entrance was never wrong, which is why this hid for so long', () => {
    const middle = { col: 20, row: 7 }
    expect(mouthCell({ w: 1, h: 1 }, middle, 0)).toEqual(middle)
  })
})
