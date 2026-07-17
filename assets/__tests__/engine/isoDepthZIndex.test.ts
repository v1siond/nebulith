/**
 * DRAW-PRIORITY (CSS z-index) in the ISO depth sort — a numeric per-asset `zIndex` that OVERRIDES the
 * positional iso depth key: a HIGHER zIndex draws LATER (on top / in front) regardless of (col,row), exactly
 * like CSS z-index. This is what puts the fountain WATER in front of a wall behind it (Images #34/#36).
 *
 * The guardrail this file locks down: when every asset keeps the DEFAULT zIndex 0 (or leaves it absent), the
 * sort must reproduce the EXACT positional order it produced before z-index existed, so no existing map's
 * draw order regresses. We assert the ACTUAL sorted draw order, not a value read-back.
 */
import { isoDepthCompare } from '@/engine/render/iso'

type Item = { id: string; col: number; row: number; asset?: { heightLevel?: number; zIndex?: number; depth?: number } }

// Draw order = the array after the SAME sort the render runs. First element = drawn first (furthest back);
// last element = drawn last (on top / in front).
const drawOrder = (items: Item[]): string[] => items.slice().sort(isoDepthCompare).map(i => i.id)

// The PRE-zIndex comparator (positional key = col+row, then heightLevel) — the exact behaviour that must be
// preserved when no asset sets a zIndex. Used as the reference the default-0 case has to match byte-for-byte.
const positionalCompare = (a: Item, b: Item): number =>
  (a.col + a.row) - (b.col + b.row) || (a.asset?.heightLevel ?? 0) - (b.asset?.heightLevel ?? 0)

describe('isoDepthCompare — z-index draw priority', () => {
  test('a HIGHER zIndex draws AFTER (on top of) a lower one, regardless of (col,row)', () => {
    // `water` sits at a LOW (col+row) → positionally it would draw FIRST (behind). `wall` sits at a HIGH
    // (col+row) → positionally it would draw LAST (in front). With z-index, the water's priority 10 must flip
    // that: the water draws LAST (on top), the wall first.
    const water: Item = { id: 'water', col: 1, row: 1, asset: { zIndex: 10 } }
    const wall: Item = { id: 'wall', col: 5, row: 5, asset: { zIndex: 0 } }

    // Positionally (no z-index) the wall would be last:
    expect([water, wall].slice().sort(positionalCompare).map(i => i.id)).toEqual(['water', 'wall'])
    // With z-index the WATER wins and draws last (on top), no matter which order we feed them in:
    expect(drawOrder([water, wall])).toEqual(['wall', 'water'])
    expect(drawOrder([wall, water])).toEqual(['wall', 'water'])
  })

  test('the bug case — a taller block BEHIND the water still draws behind it once the water has priority', () => {
    // Reproduces Images #34/#36: a wall one row BEHIND the water (lower row) that got extra height/depth so the
    // positional sort mis-ordered it OVER the water. Positionally the raised wall would draw after the water;
    // z-index restores the correct front-to-back read (water on top).
    const water: Item = { id: 'water', col: 2, row: 2, asset: { zIndex: 10, heightLevel: 0 } }
    const wallBehind: Item = { id: 'wallBehind', col: 2, row: 1, asset: { zIndex: 0, heightLevel: 3 } }

    expect(drawOrder([water, wallBehind])).toEqual(['wallBehind', 'water']) // water drawn last → in front
    // pairwise contract, both directions
    expect(isoDepthCompare(water, wallBehind)).toBeGreaterThan(0)
    expect(isoDepthCompare(wallBehind, water)).toBeLessThan(0)
  })

  test('equal zIndex falls through to the positional key (higher col+row draws later)', () => {
    const back: Item = { id: 'back', col: 1, row: 1, asset: { zIndex: 5 } }
    const front: Item = { id: 'front', col: 4, row: 4, asset: { zIndex: 5 } }
    // same priority → the positional key decides, unchanged
    expect(drawOrder([front, back])).toEqual(['back', 'front'])
  })

  test('REGRESSION GUARD: with every zIndex at the default 0 (or absent) the order is byte-identical to the positional sort', () => {
    // A mixed pile — some with explicit zIndex:0, some with zIndex absent, at varied positions + stack levels.
    // Absent must behave EXACTLY like 0, and the whole thing must match the pre-z-index positional comparator.
    const items: Item[] = [
      { id: 'a', col: 3, row: 2, asset: { heightLevel: 1 } },            // zIndex absent
      { id: 'b', col: 1, row: 4, asset: { zIndex: 0, heightLevel: 0 } },
      { id: 'c', col: 3, row: 2, asset: { zIndex: 0, heightLevel: 0 } }, // same cell as `a`, lower level
      { id: 'd', col: 0, row: 0 },                                        // no asset at all (player/entity slot)
      { id: 'e', col: 5, row: 1, asset: { heightLevel: 2 } },
      { id: 'f', col: 2, row: 2, asset: { zIndex: 0 } },
    ]
    expect(drawOrder(items)).toEqual(items.slice().sort(positionalCompare).map(i => i.id))
  })

  test('REGRESSION GUARD: default-0 preserves the bottom-up tie-break within one stacked cell', () => {
    // Two tiles in the SAME cell at different stack levels — with no z-index the higher block must still draw
    // last (on top), exactly as before. z-index must not disturb this same-cell ordering when it's 0.
    const low: Item = { id: 'low', col: 2, row: 2, asset: { heightLevel: 0 } }
    const high: Item = { id: 'high', col: 2, row: 2, asset: { heightLevel: 1 } }
    expect(drawOrder([high, low])).toEqual(['low', 'high'])
  })
})
