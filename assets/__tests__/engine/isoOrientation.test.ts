/**
 * isoOrientation — the pure math for a 4-way (90°) iso camera-rotation + tile-facing.
 *
 * These tests pin the ROTATION CONVENTION the whole feature is built on, against a HAND-COMPUTED table for a
 * non-square 5×3 grid (which is what catches the classic row/col-swap bug). The convention is deliberately the
 * SAME clockwise (CW) quarter-turn used by buildingCatalog.rotateFootprintOffset — a coord (col,row) in a w×h
 * grid turns CW to (h-1-row, col) in the swapped h×w grid — so the camera rotation composes cleanly with the
 * building-facing rotation that already exists in the codebase.
 *
 * Screen intuition for the CW claim (iso.ts projection: +col = down-right, +row = down-left, so world origin
 * (0,0) is the BACK/top corner and higher col+row is the FRONT/bottom): rotating an image CW sends
 * top-left → top-right → bottom-right → bottom-left → top-left. Every corner assertion below matches that.
 */
import {
  type Orientation,
  orientCell,
  deorientCell,
  orientedDims,
  orientedDrawKey,
  combineFacing,
  nextOrientation,
} from '@/engine/render/isoOrientation'

const COLS = 5
const ROWS = 3
const ORIENTATIONS: Orientation[] = [0, 1, 2, 3]

/** Every (col,row) of the world grid — the loop that catches the row/col-swap bug. */
function allWorldCells(cols = COLS, rows = ROWS): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = []
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) out.push({ col, row })
  return out
}

describe('orientedDims — the grid dims as seen in the view frame', () => {
  test('even turns keep dims, odd turns swap them', () => {
    expect(orientedDims(COLS, ROWS, 0)).toEqual({ cols: 5, rows: 3 })
    expect(orientedDims(COLS, ROWS, 1)).toEqual({ cols: 3, rows: 5 })
    expect(orientedDims(COLS, ROWS, 2)).toEqual({ cols: 5, rows: 3 })
    expect(orientedDims(COLS, ROWS, 3)).toEqual({ cols: 3, rows: 5 })
  })
})

describe('orientCell — rotate a WORLD coord into the VIEW frame (CW quarter-turns)', () => {
  // Hand-computed corner table for the 5×3 world grid. Corners: TL(0,0) TR(4,0) BL(0,2) BR(4,2).
  // Verified by the CW image-rotation rule TL→TR→BR→BL→TL (see file header).
  const CORNER_TABLE: Record<Orientation, { in: [number, number]; out: [number, number] }[]> = {
    0: [
      { in: [0, 0], out: [0, 0] }, { in: [4, 0], out: [4, 0] },
      { in: [0, 2], out: [0, 2] }, { in: [4, 2], out: [4, 2] },
    ],
    1: [
      // 3×5 view: TL(0,0)→TR(2,0), TR(4,0)→BR(2,4), BR(4,2)→BL(0,4), BL(0,2)→TL(0,0)
      { in: [0, 0], out: [2, 0] }, { in: [4, 0], out: [2, 4] },
      { in: [0, 2], out: [0, 0] }, { in: [4, 2], out: [0, 4] },
    ],
    2: [
      // 5×3 view, 180°: TL→BR, TR→BL, BL→TR, BR→TL
      { in: [0, 0], out: [4, 2] }, { in: [4, 0], out: [0, 2] },
      { in: [0, 2], out: [4, 0] }, { in: [4, 2], out: [0, 0] },
    ],
    3: [
      // 3×5 view (one CCW turn): TL→BL, TR→TL, BR→TR, BL→BR
      { in: [0, 0], out: [0, 4] }, { in: [4, 0], out: [0, 0] },
      { in: [0, 2], out: [2, 4] }, { in: [4, 2], out: [2, 0] },
    ],
  }

  test.each(ORIENTATIONS)('o=%i: corners land on the hand-computed cells', o => {
    for (const { in: [c, r], out: [ec, er] } of CORNER_TABLE[o]) {
      expect(orientCell(c, r, COLS, ROWS, o)).toEqual({ col: ec, row: er })
    }
  })

  test('o=0 is the identity for every cell', () => {
    for (const { col, row } of allWorldCells()) {
      expect(orientCell(col, row, COLS, ROWS, 0)).toEqual({ col, row })
    }
  })

  test.each(ORIENTATIONS)('o=%i: every oriented cell stays IN BOUNDS of the (possibly swapped) view dims', o => {
    const dims = orientedDims(COLS, ROWS, o)
    for (const { col, row } of allWorldCells()) {
      const v = orientCell(col, row, COLS, ROWS, o)
      expect(v.col).toBeGreaterThanOrEqual(0)
      expect(v.row).toBeGreaterThanOrEqual(0)
      expect(v.col).toBeLessThan(dims.cols)
      expect(v.row).toBeLessThan(dims.rows)
    }
  })

  test.each(ORIENTATIONS)('o=%i: distinct world cells map to distinct view cells (a bijection, no collisions)', o => {
    const seen = new Set<string>()
    for (const { col, row } of allWorldCells()) {
      const v = orientCell(col, row, COLS, ROWS, o)
      const key = `${v.col},${v.row}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
    expect(seen.size).toBe(COLS * ROWS)
  })
})

describe('deorientCell — the EXACT inverse (VIEW → WORLD)', () => {
  test.each(ORIENTATIONS)('o=%i: deorient ∘ orient = identity for EVERY world cell (catches the row/col swap)', o => {
    for (const { col, row } of allWorldCells()) {
      const v = orientCell(col, row, COLS, ROWS, o)
      expect(deorientCell(v.col, v.row, COLS, ROWS, o)).toEqual({ col, row })
    }
  })

  test.each(ORIENTATIONS)('o=%i: orient ∘ deorient = identity for EVERY view cell (round-trip the other way)', o => {
    const dims = orientedDims(COLS, ROWS, o)
    for (const { col, row } of allWorldCells(dims.cols, dims.rows)) {
      const wcell = deorientCell(col, row, COLS, ROWS, o)
      expect(orientCell(wcell.col, wcell.row, COLS, ROWS, o)).toEqual({ col, row })
    }
  })

  test('concrete inverse: o=1 sends world (0,0)→view (2,0), and back', () => {
    expect(orientCell(0, 0, COLS, ROWS, 1)).toEqual({ col: 2, row: 0 })
    expect(deorientCell(2, 0, COLS, ROWS, 1)).toEqual({ col: 0, row: 0 })
  })
})

describe('orientedDrawKey — back-to-front sort key in the VIEW frame (higher = drawn later / in front)', () => {
  test.each(ORIENTATIONS)('o=%i: the key equals the ORIENTED coord col+row', o => {
    for (const { col, row } of allWorldCells()) {
      const v = orientCell(col, row, COLS, ROWS, o)
      expect(orientedDrawKey(col, row, COLS, ROWS, o)).toBe(v.col + v.row)
    }
  })

  test('o=0: world back corner (0,0) has key 0, front corner (4,2) has key 6', () => {
    expect(orientedDrawKey(0, 0, COLS, ROWS, 0)).toBe(0)
    expect(orientedDrawKey(4, 2, COLS, ROWS, 0)).toBe(6)
    expect(orientedDrawKey(4, 2, COLS, ROWS, 0)).toBeGreaterThan(orientedDrawKey(0, 0, COLS, ROWS, 0))
  })

  test('occlusion rotates with the camera: under o=1 the FRONT corner is a DIFFERENT world cell', () => {
    // Under o=1 the view-frame back corner is world (0,2) (key 0) and the front is world (4,0) (key 6) —
    // the opposite of o=0, proving a cell that occludes flips as the camera turns.
    expect(orientedDrawKey(0, 2, COLS, ROWS, 1)).toBe(0)
    expect(orientedDrawKey(4, 0, COLS, ROWS, 1)).toBe(6)
    expect(orientedDrawKey(4, 0, COLS, ROWS, 1)).toBeGreaterThan(orientedDrawKey(0, 2, COLS, ROWS, 1))
  })

  test.each(ORIENTATIONS)('o=%i: a cell one step TOWARD the view-frame camera has a strictly larger key', o => {
    // Compare two adjacent world cells. Whichever is nearer the camera in the view frame (larger key) must sort
    // later. We assert the relation holds for the pair that straddles the view-frame depth axis at the centre.
    const a = orientCell(1, 1, COLS, ROWS, o)
    const b = orientCell(2, 1, COLS, ROWS, o)
    const ka = orientedDrawKey(1, 1, COLS, ROWS, o)
    const kb = orientedDrawKey(2, 1, COLS, ROWS, o)
    // The one with the larger (col+row) in the view frame is in front — and its key must be larger.
    if (a.col + a.row > b.col + b.row) expect(ka).toBeGreaterThan(kb)
    else if (a.col + a.row < b.col + b.row) expect(ka).toBeLessThan(kb)
    else expect(ka).toBe(kb)
  })
})

describe('combineFacing — on-screen facing = (worldFacing + camera) mod 4 (world facing stays FIXED)', () => {
  // WHY add, not subtract: orientCell rotates the world CW by `camera` quarter-turns into the view frame, so a
  // FIXED world direction is also carried CW by the same amount. In the facing convention (south=0, then CW:
  // west=1, north=2, east=3 — buildingCatalog.FACING_ROTATION) a +1 CW turn is +1 in the index, hence +camera.
  const FACINGS: Orientation[] = [0, 1, 2, 3]

  test('camera 0 renders the world facing unchanged', () => {
    for (const f of FACINGS) expect(combineFacing(f, 0)).toBe(f)
  })

  test('concrete shifts: a south(0) door reads west(1) at camera 1, north(2) at camera 2, east(3) at camera 3', () => {
    expect(combineFacing(0, 1)).toBe(1)
    expect(combineFacing(0, 2)).toBe(2)
    expect(combineFacing(0, 3)).toBe(3)
  })

  test('wraps mod 4: an east(3) door reads south(0) at camera 1', () => {
    expect(combineFacing(3, 1)).toBe(0)
    expect(combineFacing(2, 3)).toBe(1)
  })

  test('FIXED-world property: rotating the camera by +1 shifts the on-screen facing by exactly +1', () => {
    for (const f of FACINGS) {
      for (const c of ORIENTATIONS) {
        const next = ((c + 1) % 4) as Orientation
        expect(combineFacing(f, next)).toBe(((combineFacing(f, c) + 1) % 4))
      }
    }
  })

  test('a full 4 quarter-turns returns the on-screen facing to the start', () => {
    for (const f of FACINGS) {
      // Walk the camera all the way round; the 4th +1 turn lands back on the original on-screen facing.
      let cam: Orientation = 0
      const start = combineFacing(f, cam)
      for (let i = 0; i < 4; i++) cam = nextOrientation(cam, 1)
      expect(combineFacing(f, cam)).toBe(start)
    }
  })

  test('the four camera values hit every screen-side exactly once (a full cycle, no side skipped)', () => {
    const seen = new Set(ORIENTATIONS.map(c => combineFacing(1, c)))
    expect(seen).toEqual(new Set([0, 1, 2, 3]))
  })
})

describe('nextOrientation — cycle helper, wraps 0..3', () => {
  test('forward wraps 3 → 0', () => {
    expect(nextOrientation(0, 1)).toBe(1)
    expect(nextOrientation(1, 1)).toBe(2)
    expect(nextOrientation(2, 1)).toBe(3)
    expect(nextOrientation(3, 1)).toBe(0)
  })

  test('backward wraps 0 → 3', () => {
    expect(nextOrientation(3, -1)).toBe(2)
    expect(nextOrientation(2, -1)).toBe(1)
    expect(nextOrientation(1, -1)).toBe(0)
    expect(nextOrientation(0, -1)).toBe(3)
  })

  test('forward then backward is a no-op for every orientation', () => {
    for (const o of ORIENTATIONS) expect(nextOrientation(nextOrientation(o, 1), -1)).toBe(o)
  })
})
