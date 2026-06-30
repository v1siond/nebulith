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

  it('reaches the bottom: a focus past the bottom corner stops with it at the lower viewport edge', () => {
    const { fc, fr } = isoCameraFocus(100, 100, pPad, qPad, cols, rows)
    // bottom corner is at q = cols + rows; the viewport's lower edge (fq + qPad) reaches it.
    expect(fc + fr).toBeCloseTo(cols + rows - qPad, 6)
  })

  it('reaches further down than the old combined-span clamp (which stopped pPad short)', () => {
    const { fc, fr } = isoCameraFocus(100, 100, pPad, qPad, cols, rows)
    const oldCombinedClamp = cols + rows - (pPad + qPad) // previous (buggy) max vertical reach
    expect(fc + fr).toBeGreaterThan(oldCombinedClamp)
  })

  it('reaches the top: a focus above the top corner stops with it at the upper viewport edge', () => {
    const { fc, fr } = isoCameraFocus(-100, -100, pPad, qPad, cols, rows)
    expect(fc + fr).toBeCloseTo(qPad, 6)
  })

  it('keeps the right corner reachable horizontally', () => {
    // player at the right map corner (col = cols, row = 0): p = col - row = cols.
    const { fc, fr } = isoCameraFocus(cols, 0, pPad, qPad, cols, rows)
    expect(fc - fr).toBeCloseTo(cols - pPad, 6)
  })

  it('centres each axis when the grid is smaller than the viewport span', () => {
    const { fc, fr } = isoCameraFocus(0, 0, 50, 50, 4, 4)
    expect(fc + fr).toBeCloseTo(4, 6) // q centred in [0, cols + rows]
    expect(fc - fr).toBeCloseTo(0, 6) // p centred in [-rows, cols]
  })
})
