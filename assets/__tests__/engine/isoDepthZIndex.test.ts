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
import type { DepthDir } from '@/engine/render/isoBlock'

type Item = { id: string; col: number; row: number; blockRise?: number; asset?: { heightLevel?: number; height?: number; zIndex?: number; depth?: number; depthDir?: DepthDir } }

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

describe('isoDepthCompare — a FLAT z-width run stays behind standing tiles (road-over-house fix)', () => {
  // A flat grass/road RUN compressed with z-width: heightLevel 0, spanning `depth` cells toward the camera. Its
  // anchor (2,5) is its BACKMOST cell; the run covers col 2..6 (depth 5, right-down). A house sits at (4,5) — IN
  // FRONT of the run's back (2,5) but behind its front (6,5). A flat run occludes nothing, so it must NOT borrow
  // the roof "front-extent" (which would push its key out to the front cell col 6 → drawn OVER the house). It
  // sorts by its anchor → drawn FIRST, behind every standing tile along its span. (Reproduces Image #96.)
  const runFloor: Item = { id: 'road', col: 2, row: 5, asset: { heightLevel: 0, depth: 5, depthDir: 'right-down' } }
  const house: Item = { id: 'house', col: 4, row: 5, asset: { heightLevel: 1 } }

  test('a flat run sorts by its BACK cell → stays behind a house that sits along its span', () => {
    expect(drawOrder([house, runFloor])).toEqual(['road', 'house']) // road drawn first (behind), house on top
    expect(isoDepthCompare(runFloor, house)).toBeLessThan(0)
    expect(isoDepthCompare(house, runFloor)).toBeGreaterThan(0)
  })

  test('the front-extent is NOT flipped by depthDir — left-up (the proposed alt) also stays behind', () => {
    // Confirms the finding: `depthDir` is not the lever. The SAME flat run keyed with left-up (depthFrontExtent 0
    // by construction) also sorts behind the house — because for a FLAT run the extent is gated OFF by height,
    // not by direction. So neither right-down nor left-up ever lifts a flat run over a standing tile.
    const leftUp: Item = { id: 'road', col: 2, row: 5, asset: { heightLevel: 0, depth: 5, depthDir: 'left-up' } }
    expect(isoDepthCompare(leftUp, house)).toBeLessThan(0)
  })

  test('an ELEVATED depth box (a roof, heightLevel ≥ 1) KEEPS the front-extent — roofs unchanged', () => {
    // Same geometry but heightLevel 2 (a roof that overhangs): it DOES occlude what it covers, so it still sorts
    // by its FRONTMOST cell (col 2 + depthFrontExtent 4 = 6) and draws AFTER (over) the house at col 4.
    const roof: Item = { id: 'roof', col: 2, row: 5, asset: { heightLevel: 2, depth: 5, depthDir: 'right-down' } }
    expect(drawOrder([roof, house])).toEqual(['house', 'roof']) // roof front-extends → drawn last (over house)
    expect(isoDepthCompare(roof, house)).toBeGreaterThan(0)
  })
})

describe('isoDepthCompare — a GROUND run (heightLevel 0) NEVER front-extends: it stays under standing tiles', () => {
  // Alexander's #52 ("everything mixed together in a non-perspective way"). The ground is the base every standing
  // tile sits on, so a merged ground RUN must always sort by its BACK/ANCHOR cell and stay BEHIND the houses and
  // trees along its span — it must never paint its raised curb-face up over them.
  //
  // History: the gate used to give a ground run a FRONT-EXTENT when its rendered rise ≥ 1, to tell a raised
  // meadow/water CURB (height-1) from a flat height-0 town slab (Images #29/#31). That distinction DIED when ALL
  // terrain became height-1 GLOBAL: every floor now reads rise ≥ 1, so the extent fired for EVERY ground run and
  // each one climbed the draw order and painted over the buildings — #52. Height is uniform now, so a floor is
  // never a curb relative to its neighbours; the ground keys on its anchor, and only STACKED geometry
  // (heightLevel ≥ 1: roofs / upper levels) still front-extends. A run at (2,5) depth 5 right-down covers cols
  // 2..6 — its OLD front-extent key was 11, its anchor key is 7.
  const groundRun: Item = { id: 'ground', col: 2, row: 5, blockRise: 1, asset: { heightLevel: 0, depth: 5, depthDir: 'right-down' } }
  // A house whose anchor (10) sits BETWEEN the run's anchor (7) and its OLD front-extent (11) — the exact tile the
  // old behaviour leapfrogged and painted ground over. With the fix the run keys on 7 and stays behind it.
  const house: Item = { id: 'house', col: 6, row: 4, asset: { heightLevel: 1, height: 5 } }

  test('a raised ground run keys on its ANCHOR (no front-extent) so a house in front of it draws on top', () => {
    expect(drawOrder([groundRun, house])).toEqual(['ground', 'house']) // ground first (behind), house on top
    expect(isoDepthCompare(groundRun, house)).toBeLessThan(0)
    expect(isoDepthCompare(house, groundRun)).toBeGreaterThan(0)
  })

  test('the RISE is no longer a lever for the ground — a raised run and a flat one sort IDENTICALLY now', () => {
    // Under uniform height-1 the ground stopped reading its rise: a raised ground run and a flat one key the same
    // (both on their anchor). blockRise is still computed by the render but the ground path no longer consults it.
    const flatRun: Item = { id: 'run', col: 2, row: 5, asset: { heightLevel: 0, depth: 5, depthDir: 'right-down' } } // no rise
    expect(isoDepthCompare(groundRun, house)).toBe(isoDepthCompare(flatRun, house))
    expect(isoDepthCompare(flatRun, house)).toBeLessThan(0) // still behind
  })

  test('a ROOF (heightLevel ≥ 1) KEEPS its front-extent — the fix is scoped to the ground only', () => {
    // A roof is lifted off the ground, genuinely overhangs what it covers, and still sorts by its FRONT cell so it
    // draws over the walls/house it caps. Same geometry as the ground run but heightLevel 2 → extends to key 11.
    const roof: Item = { id: 'roof', col: 2, row: 5, asset: { heightLevel: 2, depth: 5, depthDir: 'right-down' } }
    const capped: Item = { id: 'house', col: 4, row: 5, asset: { heightLevel: 1 } } // (4,5) = 9 < roof front 11
    expect(drawOrder([roof, capped])).toEqual(['house', 'roof']) // roof front-extends → drawn last (over house)
    expect(isoDepthCompare(roof, capped)).toBeGreaterThan(0)
  })

  test('a prop standing ON the run still draws over it (ground is the base under everything)', () => {
    // A tile that sits on the run's span (heightLevel ≥ 1) has a higher positional key than the run's anchor, so it
    // naturally draws on top — the ground never occludes what stands on it.
    const propOnSpan: Item = { id: 'prop', col: 4, row: 5, asset: { heightLevel: 1 } } // a rock standing on the run's span
    expect(drawOrder([propOnSpan, groundRun])).toEqual(['ground', 'prop']) // run first (behind), prop on top
    expect(isoDepthCompare(groundRun, propOnSpan)).toBeLessThan(0)
  })
})
