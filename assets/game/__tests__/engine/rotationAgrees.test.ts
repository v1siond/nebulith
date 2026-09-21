/**
 * A ROTATED COMPOSITION MUST TURN ITS CELLS AND ITS DIRECTIONS THE SAME WAY.
 *
 * A cell's POSITION inside a composition is turned by `rotateFootprintOffset`; the directions it carries
 * (which way it spans, which way it is thin) by `rotateDepthDir`. If those two turn opposite pathways, a bridge
 * rail authored flush with the OUTER edge of the deck comes out flush with the inner one, and a bridge is the
 * only place anyone would notice.
 *
 * The check: step one cell along a direction, turn both the step and the direction, and see they still
 * describe the same move.
 */
import { rotateFootprintOffset } from '@/engine/buildingCatalog'
import { rotateDepthDir, type IsoDiagonal } from '@/engine/render/isoBlock'

/** The grid step each direction means: right-down = +col, left-down = +row. */
const STEP: Record<IsoDiagonal, { dx: number; dy: number }> = {
  'right-down': { dx: 1, dy: 0 },
  'left-down': { dx: 0, dy: 1 },
  'left-up': { dx: -1, dy: 0 },
  'right-up': { dx: 0, dy: -1 },
}
const DIRS = Object.keys(STEP) as IsoDiagonal[]

describe('footprint offsets and directions turn together', () => {
  it.each([0, 1, 2, 3])('rotation %i: a step along a direction still points that way after turning', rotation => {
    const w = 7
    const h = 4
    for (const dir of DIRS) {
      const { dx, dy } = STEP[dir]
      const from = { dx: 3, dy: 1 }
      const to = { dx: from.dx + dx, dy: from.dy + dy }
      const rFrom = rotateFootprintOffset(from.dx, from.dy, w, h, rotation)
      const rTo = rotateFootprintOffset(to.dx, to.dy, w, h, rotation)
      const moved = { dx: rTo.dx - rFrom.dx, dy: rTo.dy - rFrom.dy }
      expect({ rotation, dir, moved }).toEqual({ rotation, dir, moved: STEP[rotateDepthDir(dir, rotation)] })
    }
  })
})
