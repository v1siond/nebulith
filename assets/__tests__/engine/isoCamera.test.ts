import { isoCameraFocus } from '@/engine/render/shared'

// Iso screen axes: p = col - row (horizontal), q = col + row (vertical). The camera focus
// (fc, fr) is in cell coords; the viewport spans ±pPad in p and ±qPad in q. The clamp must
// let the camera reach the map's top/bottom (q) corners — the old combined col/row clamp
// stopped it pPad short of them (#38) — while keeping the sides within the diamond.
describe('isoCameraFocus — reaches the map vertical extremes (#38)', () => {
  const cols = 20
  const rows = 20
  const pPad = 2
  const qPad = 3

  it('reaches the bottom: a corner cell can be dragged to the viewport centre (free pan)', () => {
    const { fc, fr } = isoCameraFocus(100, 100, pPad, qPad, cols, rows)
    // free pan: the focus reaches the bottom corner q = cols + rows (centred, void below is fine).
    expect(fc + fr).toBeCloseTo(cols + rows, 6)
  })

  it('reaches further down than the old viewport-inside-map clamp (which stopped qPad short)', () => {
    const { fc, fr } = isoCameraFocus(100, 100, pPad, qPad, cols, rows)
    const oldClamp = cols + rows - qPad // previous max vertical reach (viewport edge at corner)
    expect(fc + fr).toBeGreaterThan(oldClamp)
  })

  it('reaches the top: the top corner can be dragged to the viewport centre', () => {
    const { fc, fr } = isoCameraFocus(-100, -100, pPad, qPad, cols, rows)
    expect(fc + fr).toBeCloseTo(0, 6)
  })

  it('keeps the right corner reachable horizontally (centred)', () => {
    // player at the right map corner (col = cols, row = 0): p = col - row = cols.
    const { fc, fr } = isoCameraFocus(cols, 0, pPad, qPad, cols, rows)
    expect(fc - fr).toBeCloseTo(cols, 6)
  })

  it('centres each axis when the grid is smaller than the viewport span', () => {
    const { fc, fr } = isoCameraFocus(0, 0, 50, 50, 4, 4)
    expect(fc + fr).toBeCloseTo(4, 6) // q centred in [0, cols + rows]
    expect(fc - fr).toBeCloseTo(0, 6) // p centred in [-rows, cols]
  })
})
