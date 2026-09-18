/**
 * WHICH BRIDGE CROSSES THIS RIVER.
 *
 * The span used to be chosen by walking DOWN from the landing-to-landing run and taking the first that fit, so
 * it was always the largest bridge that would go in, whatever the water underneath was doing. It is chosen by
 * the RIVER now: the smallest authored span that covers the water plus one landing each side.
 *
 * The spans the backend authors are 3, 4, 5, 6 and 7 per family, which is why `WOOD` below is that set.
 */
// chooseBridgeSpan lives in `riverNetwork` with the rest of the crossing decision: how long a bridge
// has to be is a question about the WATER, not about whichever layout happened to carve it.
import { chooseBridgeSpan } from '@/engine/riverNetwork'

/** The authored set, as `tile_source.ex` carries it and `/api/tilesets` serves it. */
const WOOD = (span: number) => [3, 4, 5, 6, 7].includes(span)
/** What was authored BEFORE 4 and 6 were added, kept so the odd-only case stays covered. */
const ODD_ONLY = (span: number) => [3, 5, 7].includes(span)
/** A long run, so the run itself never decides the answer. */
const LONG_RUN = 20

describe('chooseBridgeSpan', () => {
  it('takes the smallest authored span that covers the water plus a landing each side', () => {
    expect(chooseBridgeSpan(1, LONG_RUN, WOOD)).toBe(3)
    expect(chooseBridgeSpan(2, LONG_RUN, WOOD)).toBe(4)
    expect(chooseBridgeSpan(3, LONG_RUN, WOOD)).toBe(5)
    expect(chooseBridgeSpan(4, LONG_RUN, WOOD)).toBe(6)
    expect(chooseBridgeSpan(5, LONG_RUN, WOOD)).toBe(7)
  })

  it('does not hand a small river the biggest bridge that would fit, which is the whole complaint', () => {
    // A 4-wide river on a run with room for 20. The old walk answered with the longest authored span.
    expect(chooseBridgeSpan(4, LONG_RUN, WOOD)).toBe(6)
    expect(chooseBridgeSpan(4, LONG_RUN, WOOD)).not.toBe(7)
  })

  it('never goes under the three-cell minimum, however narrow the water', () => {
    expect(chooseBridgeSpan(0, LONG_RUN, WOOD)).toBe(3)
    expect(chooseBridgeSpan(-5, LONG_RUN, WOOD)).toBe(3)
  })

  it('rounds up to the next authored size when the exact one was never drawn', () => {
    // 3 wide wants 5, which exists in both sets. 2 wide wants 4, which the odd-only set skips, so it takes 5.
    expect(chooseBridgeSpan(3, LONG_RUN, ODD_ONLY)).toBe(5)
    expect(chooseBridgeSpan(2, LONG_RUN, ODD_ONLY)).toBe(5)
  })

  it('falls back to the longest authored rather than leaving the crossing bare', () => {
    // Nothing authored reaches 10 + 2, and a deck with no structure on it does not read as a bridge.
    expect(chooseBridgeSpan(10, LONG_RUN, WOOD)).toBe(7)
  })

  it('REACHES ACROSS even when the deck run is shorter than the river', () => {
    // The run used to cap the choice, so a deck shorter than its own river picked a span that could not
    // cross it: measured on a generated map, water five cells wide with a span-4 bridge on it and open river
    // left past the far end. The run is where the PATH met the water, a fact about the path; the span has one
    // job and it is to get you to the other side. A bridge overhanging its deck onto the bank is a bridge
    // with abutments.
    expect(chooseBridgeSpan(4, 5, WOOD)).toBe(6)
    expect(chooseBridgeSpan(5, 4, WOOD)).toBeGreaterThanOrEqual(5)
    expect(chooseBridgeSpan(7, 3, WOOD)).toBeGreaterThanOrEqual(7)
  })

  it('answers null when the family has no authored spans at all', () => {
    expect(chooseBridgeSpan(4, LONG_RUN, () => false)).toBeNull()
  })

  it('and a tiny run is no reason to refuse a crossing, because the run is not the river', () => {
    // This asserted null for a short run. A two-cell run over a one-cell creek still wants the smallest
    // authored bridge: refusing left the deck bare, which is the one outcome the fallback above exists to
    // prevent.
    expect(chooseBridgeSpan(1, 2, WOOD)).toBe(3)
  })
})
