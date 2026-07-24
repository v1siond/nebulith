/**
 * MAP DRAG IS SCREEN-FIXED — the camera rotates the map, not the controls. User: "moving camera horizontally
 * has nothing to do with the drag functionality, drag should work the same regardless of the perspective …
 * it gets inverted when rotating camera."
 *
 * The pan (camOffset) used to be folded into the focus BEFORE `isoViewFocus` oriented it, so it spun with the
 * camera. Now the player focus is oriented; the pan is applied AFTER, un-rotated. This pins that: a given pan
 * shifts the focus by the SAME amount at every facing, and facing 0 is unchanged.
 */
import { isoViewFocus } from '@/engine/render/iso'
import type { Orientation } from '@/engine/render/isoOrientation'

const PFC = 12, PFR = 8, COLS = 30, ROWS = 20, PAN_C = 1.3, PAN_R = -0.7
const FACINGS: Orientation[] = [0, 1, 2, 3]

describe('drag pan is un-rotated (screen-fixed at every camera facing)', () => {
  it('a pan shifts the focus by exactly (-panCol, -panRow) at every facing — the pan never spins', () => {
    for (const facing of FACINGS) {
      const noPan = isoViewFocus(PFC, PFR, 0, 0, 100, 100, COLS, ROWS, facing, false)
      const panned = isoViewFocus(PFC, PFR, PAN_C, PAN_R, 100, 100, COLS, ROWS, facing, false)
      expect(panned.fc).toBeCloseTo(noPan.fc - PAN_C)
      expect(panned.fr).toBeCloseTo(noPan.fr - PAN_R)
    }
  })

  it('the pan direction is identical across facings (facing-independent) — the whole point', () => {
    const shift = (facing: Orientation) => {
      const a = isoViewFocus(PFC, PFR, 0, 0, 100, 100, COLS, ROWS, facing, false)
      const b = isoViewFocus(PFC, PFR, PAN_C, PAN_R, 100, 100, COLS, ROWS, facing, false)
      return { dc: b.fc - a.fc, dr: b.fr - a.fr }
    }
    const s0 = shift(0)
    for (const facing of [1, 2, 3] as const) {
      expect(shift(facing).dc).toBeCloseTo(s0.dc)
      expect(shift(facing).dr).toBeCloseTo(s0.dr)
    }
  })

  it('facing 0 (unclamped editor) is exactly the old behaviour: focus = player − pan', () => {
    const f = isoViewFocus(PFC, PFR, PAN_C, PAN_R, 100, 100, COLS, ROWS, 0, false)
    expect(f.fc).toBeCloseTo(PFC - PAN_C)
    expect(f.fr).toBeCloseTo(PFR - PAN_R)
  })
})
