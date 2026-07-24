/**
 * ROTATING KEEPS THE VIEW ANCHORED. User: "when I rotate, the camera moves right/up/bottom/left randomly …
 * map should always be anchored at the center for rotations or to the specific position I was before."
 *
 * The world point at screen centre is `player − R₋facing(pan)` (pan = camOffset in cells). When only `facing`
 * changed, that point moved → the view flung away from whatever you'd panned to. `panKeepingCenter` rotates
 * the pan by the facing delta so the SAME world point stays centred: the map turns around what you were
 * looking at. This proves it against the REAL projection (isoViewFocus) and its inverse (deorientCell).
 */
import { panKeepingCenter } from '@/components/game/cameraControls'
import { isoViewFocus } from '@/engine/render/iso'
import { deorientCell, type Orientation } from '@/engine/render/isoOrientation'

const COLS = 50, ROWS = 50, CELL = 100
const PLAYER = { fc: 25, fr: 25 }      // player cell (camera target base)
const PAN = { x: 640, y: -280 }        // a drag pan in PIXELS (the user had panned to the store)

/** The WORLD cell at screen centre for a given facing + pan — deorient(the view focus). Editor = unclamped. */
function centeredCell(facing: Orientation, pan: { x: number; y: number }) {
  const f = isoViewFocus(PLAYER.fc, PLAYER.fr, pan.x / CELL, pan.y / CELL, 999, 999, COLS, ROWS, facing, false)
  return deorientCell(f.fc, f.fr, COLS, ROWS, facing)
}

const FACINGS: Orientation[] = [0, 1, 2, 3]

describe('rotation stays anchored on the point you were looking at', () => {
  it('the centred world point is IDENTICAL after any rotation, when the pan is carried through panKeepingCenter', () => {
    const base = centeredCell(0, PAN)
    for (const to of FACINGS) {
      const c = centeredCell(to, panKeepingCenter(PAN, 0, to))
      expect(c.col).toBeCloseTo(base.col)
      expect(c.row).toBeCloseTo(base.row)
    }
  })

  it('works from ANY starting facing, not just 0 (rotate 2→3, 3→0, …)', () => {
    for (const from of FACINGS) {
      const base = centeredCell(from, PAN)
      const to = ((from + 1) % 4) as Orientation
      const c = centeredCell(to, panKeepingCenter(PAN, from, to))
      expect(c.col).toBeCloseTo(base.col)
      expect(c.row).toBeCloseTo(base.row)
    }
  })

  it('WITHOUT the fix the centre moves — proving the bug is real (control)', () => {
    const base = centeredCell(0, PAN)
    const moved = centeredCell(1, PAN) // same pan, just rotated facing → the old buggy behaviour
    expect(Math.abs(moved.col - base.col) + Math.abs(moved.row - base.row)).toBeGreaterThan(1)
  })

  it('a zero pan (already player-centred) is unaffected — no needless shift', () => {
    for (const to of FACINGS) expect(panKeepingCenter({ x: 0, y: 0 }, 0, to)).toEqual({ x: 0, y: 0 })
  })
})
