/**
 * A Z-WIDTH RUN MUST STAY BEHIND WHAT IS IN FRONT OF IT, AT EVERY CAMERA FACING.
 *
 * User (Images #11/#12, after rotating): "z-index is weird in tiles when rotating, for example, I see grass
 * blocking trees trunks, among other things".
 *
 * `compressGround` merges contiguous floor cells into ONE run tile anchored at its BACKMOST cell (min col /
 * min row) — backmost *at facing 0*. `isoDepthCompare` keys on the anchor's `col + row`, and `depthFrontExtent`
 * only adds the span length when the span runs TOWARD the camera (`dc + dr > 0`). Both rules depend on one
 * unwritten invariant: THE ANCHOR IS THE BACKMOST CELL OF THE SPAN.
 *
 * Rotating breaks it. A quarter-turn can send a span's direction to `left-up`/`right-up` (dc+dr < 0), so the
 * stored anchor becomes the run's FRONT end while the comparator still treats it as the back — the run then
 * sorts as the nearest thing on screen and paints over everything genuinely behind it. Single tiles are
 * unaffected (no far end to get backwards), which is why this only appeared once rotation met compressed ground.
 */
import { isoDepthComparatorFor, isoDepthCompare } from '@/engine/render/iso'
import { spanBackmost, DEPTH_CELL_STEP } from '@/engine/render/isoBlock'
import type { DepthDir } from '@/engine/render/isoBlock'

const COLS = 20, ROWS = 20

/** A flat merged ground run (heightLevel 0), like compressGround produces. */
const run = (col: number, row: number, depth: number, depthDir: DepthDir) =>
  ({ col, row, asset: { heightLevel: 0, depth, depthDir } })

/** An ordinary standing tile — a tree trunk, say. */
const standing = (col: number, row: number) => ({ col, row, asset: { heightLevel: 0 } })

describe('spanBackmost — the anchor must name the span end FARTHEST from the camera', () => {
  it('leaves a forward-running span alone (the anchor is already backmost)', () => {
    expect(spanBackmost(5, 5, 4, 'right-down')).toEqual({ col: 5, row: 5, dir: 'right-down' })
    expect(spanBackmost(5, 5, 3, 'left-down')).toEqual({ col: 5, row: 5, dir: 'left-down' })
  })

  it('moves the anchor to the far end of a BACKWARD-running span and flips its direction', () => {
    // 'left-up' steps (-1, 0): a depth-4 span from (8,5) covers cols 8,7,6,5 — so the backmost cell is (5,5)
    // and, measured from there, the span runs 'right-down'.
    expect(spanBackmost(8, 5, 4, 'left-up')).toEqual({ col: 5, row: 5, dir: 'right-down' })
    // 'right-up' steps (0, -1): a depth-3 span from (5,7) covers rows 7,6,5 → backmost (5,5), running 'left-down'.
    expect(spanBackmost(5, 7, 3, 'right-up')).toEqual({ col: 5, row: 5, dir: 'left-down' })
  })

  it('leaves a single-cell tile untouched — there is no far end', () => {
    expect(spanBackmost(5, 5, 1, 'left-up')).toEqual({ col: 5, row: 5, dir: 'left-up' })
    expect(spanBackmost(5, 5, 0, 'left-up')).toEqual({ col: 5, row: 5, dir: 'left-up' })
  })

  it('agrees with DEPTH_CELL_STEP: the returned direction always runs toward the camera', () => {
    for (const dir of Object.keys(DEPTH_CELL_STEP) as DepthDir[]) {
      const out = spanBackmost(9, 9, 3, dir)
      const step = DEPTH_CELL_STEP[out.dir]
      expect(step.dc + step.dr).toBeGreaterThan(0)
    }
  })
})

describe('a rotated ground run stays behind the tiles in front of it', () => {
  // A 4-cell grass run along +col at row 5, and a standing tile one row nearer the camera at its far end.
  const grassRun = run(5, 5, 4, 'right-down') // covers (5,5) (6,5) (7,5) (8,5)
  const treeTrunk = standing(8, 4)

  it('sorts the run BEHIND the standing tile at facing 0 (the untouched baseline)', () => {
    const cmp = isoDepthComparatorFor([grassRun, treeTrunk], COLS, ROWS, 0)
    expect(cmp).toBe(isoDepthCompare) // facing 0 must be the identical function — byte-identical frame
    expect(cmp(grassRun, treeTrunk)).toBeLessThan(0)
  })

  it('STILL sorts the run behind it after a half turn (the reported bug)', () => {
    const cmp = isoDepthComparatorFor([grassRun, treeTrunk], COLS, ROWS, 2)
    expect(cmp(grassRun, treeTrunk)).toBeLessThan(0)
  })

  // Rotation is SUPPOSED to swap which tile is in front, so "the run is always behind that tree" is not the
  // invariant — at facing 3 the tree really does end up behind the run. The invariant is about the run itself:
  // it sorts by its BACKMOST end, so it can never sort after a tile sitting at either of its own end cells.
  it('sorts by its backmost end at every facing — never as if it were at its front end', () => {
    const endA = standing(5, 5) // the run's two extremes, as plain single tiles
    const endB = standing(8, 5)

    for (const facing of [0, 1, 2, 3] as const) {
      const cmp = isoDepthComparatorFor([grassRun, endA, endB], COLS, ROWS, facing)

      // Tie with whichever end is the backmost one, strictly before the other. Never after either.
      expect(cmp(grassRun, endA)).toBeLessThanOrEqual(0)
      expect(cmp(grassRun, endB)).toBeLessThanOrEqual(0)
      expect(Math.min(cmp(grassRun, endA), cmp(grassRun, endB))).toBeLessThan(0)
      expect(Math.max(cmp(grassRun, endA), cmp(grassRun, endB))).toBe(0)
    }
  })

  it('does not invert ordinary single tiles — rotation still reorders them by depth', () => {
    const near = standing(9, 9), far = standing(2, 2)
    const at0 = isoDepthComparatorFor([near, far], COLS, ROWS, 0)
    const at2 = isoDepthComparatorFor([near, far], COLS, ROWS, 2)

    expect(at0(far, near)).toBeLessThan(0)  // far drawn first
    expect(at2(near, far)).toBeLessThan(0)  // after a half turn the roles swap
  })
})
