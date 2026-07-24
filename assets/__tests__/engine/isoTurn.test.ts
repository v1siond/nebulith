/**
 * CONTINUOUS CAMERA TURN — the pure maths behind the ANIMATED, draggable iso rotation.
 *
 * Alexander: "when rotating i want to see the animation of the world rotating, in fact, Ideally, I should have
 * a controller that allows me to rotate more accurately, with the current 4 options as the quick turnarounds."
 * The chosen shape: a drag SPINS the world continuously and, on release, EASES into the NEAREST of the 4
 * corners; the existing 4 buttons stay as quick jumps (now animated). At REST nothing changes — the grid model,
 * the depth sort and the baked tile art are exactly today's.
 *
 * This file pins the pure half (no canvas, no render): the turn value, the continuous rotation it drives, and
 * the easing/settle helpers. The rendered frame is `isoCameraTurn.test.ts`.
 *
 * The hard requirement running through it: a WHOLE turn must be the EXACT quarter-turn maths the 4-way camera
 * already ships (`orientCell`/`deorientCell`), so a settled camera can never drift from today's frame.
 */
import {
  wrapTurn, isWholeTurn, facingForTurn, orientedDimsForTurn,
  orientCellTurn, deorientCellTurn, cellOrienterFor,
  settleTarget, spinTarget, turnAt, easeOutCubic,
} from '@/engine/render/isoTurn'
import { orientCell, deorientCell, orientedDims, type Orientation } from '@/engine/render/isoOrientation'

// A deliberately NON-SQUARE map: an odd turn swaps the view dims, so a dims bug can't hide behind a square.
const COLS = 5, ROWS = 3
const WHOLE: Orientation[] = [0, 1, 2, 3]
const everyCell = (fn: (col: number, row: number) => void): void => {
  for (let col = 0; col < COLS; col++) for (let row = 0; row < ROWS; row++) fn(col, row)
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('wrapTurn — quarter-turns live on a 0..4 circle', () => {
  test('a turn already in range comes back EXACTLY (no float drift through the modulo)', () => {
    for (const t of [0, 0.25, 1, 2.5, 3.999]) expect(wrapTurn(t)).toBe(t)
  })

  test('a full revolution is the origin again', () => {
    expect(wrapTurn(4)).toBe(0)
    expect(wrapTurn(8)).toBe(0)
    expect(wrapTurn(4.25)).toBeCloseTo(0.25, 12)
  })

  test('a negative turn wraps forward', () => {
    expect(wrapTurn(-1)).toBe(3)
    expect(wrapTurn(-0.5)).toBe(3.5)
    expect(wrapTurn(-4)).toBe(0)
  })

  test('negative zero normalises to 0 (so a wrapped turn compares === 0)', () => {
    expect(Object.is(wrapTurn(-0), 0)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('facingForTurn / isWholeTurn — which of the 4 corners a turn is nearest', () => {
  test('a whole turn IS its facing', () => {
    for (const o of WHOLE) expect(facingForTurn(o)).toBe(o)
    expect(facingForTurn(4)).toBe(0)
    expect(facingForTurn(-1)).toBe(3)
  })

  test('a fractional turn resolves to the NEAREST corner, wrapping past the last one', () => {
    expect(facingForTurn(0.4)).toBe(0)
    expect(facingForTurn(0.6)).toBe(1)
    expect(facingForTurn(2.4)).toBe(2)
    expect(facingForTurn(3.4)).toBe(3)
    expect(facingForTurn(3.7)).toBe(0) // past the last corner → back to the first
    expect(facingForTurn(-0.4)).toBe(0)
  })

  test('isWholeTurn separates a settled camera from a spinning one', () => {
    for (const t of [0, 1, 2, 3, 4, -2]) expect(isWholeTurn(t)).toBe(true)
    for (const t of [0.001, 0.5, 2.75, 3.999]) expect(isWholeTurn(t)).toBe(false)
  })

  test('orientedDimsForTurn follows the nearest corner (an odd corner swaps cols/rows)', () => {
    expect(orientedDimsForTurn(COLS, ROWS, 0)).toEqual({ cols: COLS, rows: ROWS })
    expect(orientedDimsForTurn(COLS, ROWS, 1)).toEqual({ cols: ROWS, rows: COLS })
    expect(orientedDimsForTurn(COLS, ROWS, 0.6)).toEqual(orientedDims(COLS, ROWS, 1))
    expect(orientedDimsForTurn(COLS, ROWS, 0.4)).toEqual(orientedDims(COLS, ROWS, 0))
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('orientCellTurn — a WHOLE turn is TODAY\'S quarter-turn maths, untouched (regression guard)', () => {
  test('every cell at every whole turn equals orientCell exactly', () => {
    for (const o of WHOLE) everyCell((col, row) => {
      expect({ o, col, row, ...orientCellTurn(col, row, COLS, ROWS, o) })
        .toEqual({ o, col, row, ...orientCell(col, row, COLS, ROWS, o) })
    })
  })

  test('a turn outside 0..4 wraps onto the same corner maths', () => {
    everyCell((col, row) => {
      expect(orientCellTurn(col, row, COLS, ROWS, 4)).toEqual(orientCell(col, row, COLS, ROWS, 0))
      expect(orientCellTurn(col, row, COLS, ROWS, 5)).toEqual(orientCell(col, row, COLS, ROWS, 1))
      expect(orientCellTurn(col, row, COLS, ROWS, -1)).toEqual(orientCell(col, row, COLS, ROWS, 3))
    })
  })

  test('the result at a whole turn is INTEGER-valued (no float residue from a continuous path)', () => {
    for (const o of WHOLE) everyCell((col, row) => {
      const v = orientCellTurn(col, row, COLS, ROWS, o)
      expect(Number.isInteger(v.col) && Number.isInteger(v.row)).toBe(true)
    })
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('orientCellTurn — a FRACTIONAL turn spins the grid about its own centre', () => {
  // Independent expectation: centre the coord on the grid middle, rotate it by turn×90° CW, re-centre on the
  // VIEW middle. Written out here from first principles so it can't just echo the implementation.
  const expectedContinuous = (col: number, row: number, turn: number): { col: number; row: number } => {
    const theta = turn * (Math.PI / 2)
    const cos = Math.cos(theta), sin = Math.sin(theta)
    const cu = col - (COLS - 1) / 2, cv = row - (ROWS - 1) / 2
    const view = orientedDims(COLS, ROWS, facingForTurn(turn))
    return { col: cu * cos - cv * sin + (view.cols - 1) / 2, row: cu * sin + cv * cos + (view.rows - 1) / 2 }
  }

  test('at turn 0.5 the map corner (0,0) sits at the hand-derived 45° position', () => {
    // cu=-2, cv=-1, cos=sin=√2/2 → du=-√2/2, dv=-3√2/2; the view centre at the nearest corner (1) is (1,2).
    const v = orientCellTurn(0, 0, COLS, ROWS, 0.5)
    expect(v.col).toBeCloseTo(1 - Math.SQRT2 / 2, 10)
    expect(v.row).toBeCloseTo(2 - 3 * Math.SQRT2 / 2, 10)
    expect(v.col).toBeCloseTo(expectedContinuous(0, 0, 0.5).col, 10)
    expect(v.row).toBeCloseTo(expectedContinuous(0, 0, 0.5).row, 10)
  })

  test('every cell matches the first-principles rotation, at several fractional turns', () => {
    for (const turn of [0.2, 0.5, 0.8, 1.37, 2.5, 3.9]) everyCell((col, row) => {
      const got = orientCellTurn(col, row, COLS, ROWS, turn)
      const want = expectedContinuous(col, row, turn)
      expect(got.col).toBeCloseTo(want.col, 10)
      expect(got.row).toBeCloseTo(want.row, 10)
    })
  })

  test('it converges on the whole-turn maths as the corner is approached (no seam at the corner)', () => {
    const nearly = orientCellTurn(0, 0, COLS, ROWS, 1 - 1e-9)
    const at = orientCell(0, 0, COLS, ROWS, 1)
    expect(nearly.col).toBeCloseTo(at.col, 6)
    expect(nearly.row).toBeCloseTo(at.row, 6)
  })

  test('the spin is CONTINUOUS across the 45° corner-crossover — the OFFSET FROM THE FOCUS never jumps', () => {
    // At 0.5 the nearest corner flips 0→1 and the view dims swap, which moves the absolute view coords. What
    // the renderer projects is the offset from the camera focus, and BOTH go through this same function — so
    // the dims term cancels and the pixels stay smooth. That cancellation is the whole design, so pin it.
    const focus = { col: (COLS - 1) / 2, row: (ROWS - 1) / 2 }
    const offset = (turn: number) => {
      const cell = orientCellTurn(0, 0, COLS, ROWS, turn)
      const cam = orientCellTurn(focus.col, focus.row, COLS, ROWS, turn)
      return { col: cell.col - cam.col, row: cell.row - cam.row }
    }
    const step = (a: number, b: number): number => {
      const from = offset(a), to = offset(b)
      return Math.hypot(to.col - from.col, to.row - from.row)
    }
    // The same tiny angular step, taken ACROSS the crossover and well away from it, must cost the same
    // distance. A leaked dims term would make the crossover step ~1 whole cell instead of ~0.0007.
    expect(step(0.4999, 0.5001)).toBeCloseTo(step(0.2999, 0.3001), 6)
    expect(step(0.4999, 0.5001)).toBeLessThan(0.01)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('cellOrienterFor — the per-frame orienter (cos/sin resolved once, not per tile)', () => {
  test('it agrees with the single-shot call at whole AND fractional turns', () => {
    for (const turn of [0, 1, 2, 3, 0.33, 2.75]) {
      const orient = cellOrienterFor(COLS, ROWS, turn)
      everyCell((col, row) => expect(orient(col, row)).toEqual(orientCellTurn(col, row, COLS, ROWS, turn)))
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('deorientCellTurn — VIEW → WORLD, the inverse the pick needs', () => {
  test('a whole turn is TODAY\'S deorientCell, exactly', () => {
    for (const o of WHOLE) {
      const dims = orientedDims(COLS, ROWS, o)
      for (let col = 0; col < dims.cols; col++) for (let row = 0; row < dims.rows; row++) {
        expect(deorientCellTurn(col, row, COLS, ROWS, o)).toEqual(deorientCell(col, row, COLS, ROWS, o))
      }
    }
  })

  test('it inverts orientCellTurn exactly at a fractional turn', () => {
    for (const turn of [0.25, 1.6, 3.4]) everyCell((col, row) => {
      const v = orientCellTurn(col, row, COLS, ROWS, turn)
      const back = deorientCellTurn(v.col, v.row, COLS, ROWS, turn)
      expect(back.col).toBeCloseTo(col, 9)
      expect(back.row).toBeCloseTo(row, 9)
    })
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('easeOutCubic + turnAt — the release settles, it does not snap', () => {
  test('the easing runs 0→1, clamps outside, and decelerates (ease OUT)', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(-2)).toBe(0)
    expect(easeOutCubic(3)).toBe(1)
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5) // most of the distance is covered early
    let prev = -1
    for (let p = 0; p <= 1.0001; p += 0.05) { const v = easeOutCubic(p); expect(v).toBeGreaterThan(prev); prev = v }
  })

  test('progress 0 holds the start, progress 1 lands EXACTLY on the target (wrapped)', () => {
    expect(turnAt(1.3, 2, 0)).toBe(1.3)
    expect(turnAt(1.3, 2, 1)).toBe(2)
    expect(turnAt(3.7, 4, 1)).toBe(0) // the wrap: settling forward past the last corner rests at 0
    expect(Number.isInteger(turnAt(2.4, settleTarget(2.4), 1))).toBe(true)
  })

  test('mid-flight it is strictly between the two, and monotone', () => {
    const seen = [0.1, 0.3, 0.5, 0.7, 0.9].map(p => turnAt(1.3, 2, p))
    for (const v of seen) { expect(v).toBeGreaterThan(1.3); expect(v).toBeLessThan(2) }
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
  })

  test('the easing curve is injectable (a button spin can ease in AND out without changing this unit)', () => {
    expect(turnAt(0, 1, 0.5, p => p)).toBeCloseTo(0.5, 12) // linear
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('settleTarget — a released drag eases to the NEAREST whole turn', () => {
  test('from EITHER side of every corner', () => {
    expect(settleTarget(0.4)).toBe(0)
    expect(settleTarget(0.6)).toBe(1)
    expect(settleTarget(1.4)).toBe(1)
    expect(settleTarget(1.6)).toBe(2)
    expect(settleTarget(2.4)).toBe(2)
    expect(settleTarget(2.6)).toBe(3)
    expect(settleTarget(3.4)).toBe(3)
  })

  test('3.7 settles FORWARD onto the wrap (4 ≡ 0), never backwards to 3', () => {
    expect(settleTarget(3.7)).toBe(4)           // the animation target — keeps spinning the short way
    expect(wrapTurn(settleTarget(3.7))).toBe(0) // the value it rests at
    expect(turnAt(3.7, settleTarget(3.7), 1)).toBe(0)
  })

  test('a camera already at a corner does not move', () => {
    for (const o of WHOLE) expect(settleTarget(o)).toBe(o)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('spinTarget — the 4 buttons animate N quarter-turns instead of snapping', () => {
  test('from a whole turn it adds N', () => {
    expect(spinTarget(1, 1)).toBe(2)
    expect(spinTarget(3, 1)).toBe(4)
    expect(spinTarget(0, -1)).toBe(-1)
    expect(spinTarget(0, 2)).toBe(2)
  })

  test('a spin of N quarter-turns from ANY start lands on the right facing', () => {
    for (const from of [0, 1, 2, 3, 0.3, 1.9, 2.5, 3.7]) {
      for (let n = -4; n <= 4; n++) {
        const target = spinTarget(from, n)
        expect({ from, n, whole: Number.isInteger(target) }).toEqual({ from, n, whole: true })
        expect({ from, n, facing: facingForTurn(target) })
          .toEqual({ from, n, facing: facingForTurn(settleTarget(from) + n) })
      }
    }
  })

  test('pressed mid-spin it still lands on a CORNER (never on a fractional angle)', () => {
    expect(spinTarget(1.3, 1)).toBe(2)
    expect(spinTarget(1.7, 1)).toBe(3)
    expect(facingForTurn(spinTarget(3.7, 1))).toBe(1) // 3.7 → nearest corner 4, +1 → 5 ≡ 1
  })
})
