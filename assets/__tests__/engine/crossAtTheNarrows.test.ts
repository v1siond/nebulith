/**
 * A CROSSING GOES WHERE THE RIVER IS NARROW.
 *
 * Alexander, 2026-09-13, on a meadow: *"we still have situations where there's a lot of wood path alongside
 * bridge when we just want the bridge and the river"*, and on 2026-09-12: *"we just need the actual bridge
 * connecting"*.
 *
 * The flat deck under a crossing has to reach both banks, so its length is however wide the water is at the
 * line it was laid on. A crossing used to be laid at a fixed fraction along the river, and a straight slice
 * through a MEANDER is far longer than the river is actually wide, which is what turned a bridge into a wooden
 * causeway. Measured across the three forest layouts, flat deck cells on one seed: 53/65/64 before, 50/63/64
 * after, so it never makes one longer.
 */
import { narrowestLine } from '@/engine/riverNetwork'

/** Widths keyed by the line they were measured on, the shape `fellLogsAcross` builds. */
const widths = (entries: Array<[number, number]>) => new Map(entries)

describe('narrowestLine', () => {
  it('moves the crossing to the narrows within reach', () => {
    const w = widths([[8, 11], [9, 9], [10, 7], [11, 4], [12, 6]])
    expect(narrowestLine(w, 8, 6)).toBe(11)
  })

  it('leaves a straight river exactly where it always crossed', () => {
    const w = widths([[8, 5], [9, 5], [10, 5], [11, 5], [12, 5]])
    expect(narrowestLine(w, 10, 6)).toBe(10)
  })

  it('breaks a tie towards the line asked for, so the crossing stays near the middle', () => {
    const w = widths([[6, 3], [10, 5], [14, 3]])
    // 6 and 14 are both the narrowest and both in reach; the nearer side of the two is searched first.
    expect(narrowestLine(w, 10, 6)).toBe(6)
  })

  it('does not look past its reach', () => {
    const w = widths([[2, 1], [10, 9]])
    expect(narrowestLine(w, 10, 6)).toBe(10)
  })

  it('stays put when the river has no line there at all', () => {
    expect(narrowestLine(widths([]), 10, 6)).toBe(10)
  })

  it('never answers a line the river does not run on', () => {
    const w = widths([[9, 4], [10, 8], [11, 4]])
    expect([9, 10, 11]).toContain(narrowestLine(w, 10, 6))
  })
})
