/**
 * ANIMATED CAMERA TURN IN ISO — end-to-end through render().
 *
 * Alexander: "when rotating i want to see the animation of the world rotating, in fact, Ideally, I should have
 * a controller that allows me to rotate more accurately, with the current 4 options as the quick turnarounds."
 * Chosen shape: the world SPINS continuously while you drag and EASES into the NEAREST of the 4 corners on
 * release; the 4 buttons stay as quick jumps. **At rest nothing about today's render changes.**
 *
 * So this file asserts, against the RENDERED frame (the pure maths is `isoTurn.test.ts`):
 *   1. A WHOLE turn is BIT-IDENTICAL to today — same op stream as the `cameraFacing` render, and the same
 *      literal screen coords `isoCameraRotation.test.ts` already pins. This is the hard regression guard.
 *   2. A FRACTIONAL turn really rotates the world: a known corner lands at a predicted INTERMEDIATE screen
 *      position, and the sweep is smooth — including across the 45° nearest-corner crossover.
 *   3. The depth sort mid-turn uses the CONTINUOUS projected key: the order flips where the two tiles are
 *      genuinely at the same screen depth, NOT at the corner crossover.
 *   4. The pick still round-trips at REST.
 *   5. The `__setCameraTurn` / `__cameraTurn` seams the UI controller will drive.
 *
 * Deterministic camera idiom from isoCameraRotation.test.ts: cellSize 100 / isoScale 1 (tileW 71, tileH 36),
 * clampCamera:false, player on the map CENTRE — so every expected pixel is exact.
 */
import '@/__tests__/helpers/installTilesetSeed'
import {
  render, pickIsoTileAt, renderedTilesInRect, isoRecordedGeom, isoViewFocus,
  isoWorldCellToScreen, isoScreenToWorldCell, isoDepthComparatorFor,
  setIsoCameraTurn, isoCameraTurn, isoCameraFacing,
} from '@/engine/render/iso'
import { type Orientation } from '@/engine/render/isoOrientation'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { ASCII_STYLE } from '@/game/artStyle'
import type { PlayerState } from '@/game/runtime/player'

const CELL = 100, W = 800, H = 600, ISO = 1
const TILE_W = CELL * ISO * 0.71, TILE_H = CELL * ISO * 0.36
// A NON-SQUARE map: an odd turn swaps the view dims, so a dims bug can't hide behind a square.
const COLS = 5, ROWS = 3
const PCOL = 2, PROW = 1 // the map centre — the four corners are then a clean turn about the middle
const WHOLE: Orientation[] = [0, 1, 2, 3]
const CORNERS: readonly [number, number][] = [[0, 0], [COLS - 1, 0], [COLS - 1, ROWS - 1], [0, ROWS - 1]]

const player = (): PlayerState => ({ x: PCOL * CELL, z: PROW * CELL, moving: false } as PlayerState)

/** A no-op ctx — the tile GEOMETRY the pick reads is independent of the pixels drawn. */
function mockCtx(): CanvasRenderingContext2D {
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline, lineWidth: 1, lineCap: '' as CanvasLineCap, globalAlpha: 1,
    save() {}, restore() {}, rotate() {}, translate() {}, scale() {}, setLineDash() {},
    transform() {}, setTransform() {}, resetTransform() {}, getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arc() {},
    ellipse() {}, closePath() {}, fill() {}, stroke() {}, clip() {}, rect() {}, drawImage() {},
    createLinearGradient() { return { addColorStop() {} } }, createRadialGradient() { return { addColorStop() {} } },
    createPattern() { return null }, putImageData() {}, getImageData() { return { data: [] } },
    fillRect() {}, strokeRect() {}, fillText() {}, strokeText() {}, measureText() { return { width: 10 } as TextMetrics },
  }
  return ctx as unknown as CanvasRenderingContext2D
}

/** A ctx that LOGS every draw call + style write, so two frames can be compared operation-for-operation.
 *  Numbers are logged at FULL double precision (not rounded): "bit-identical at rest" is the requirement, so a
 *  1-ulp drift from a float rotation path where today's integer maths belongs has to show up here. */
function recordingCtx(log: string[]): CanvasRenderingContext2D {
  const base = mockCtx() as unknown as Record<string, unknown>
  const target: Record<string, unknown> = {}
  for (const key of Object.keys(base)) {
    const v = base[key]
    target[key] = typeof v === 'function'
      ? (...args: unknown[]) => { log.push(`${key}(${args.map(a => String(a)).join(',')})`); return (v as (...a: unknown[]) => unknown).apply(target, args) }
      : v
  }
  return new Proxy(target, {
    set(obj, prop, value) { log.push(`${String(prop)}=${String(value)}`); obj[prop as string] = value; return true },
  }) as unknown as CanvasRenderingContext2D
}

const gridWith = (assets: GridAsset[]): IsometricGrid => {
  const grid = new IsometricGrid({ cols: COLS, rows: ROWS, cellSize: CELL, isoScale: ISO })
  grid.setAssets(assets)
  return grid
}

/** One block per map corner — the four things whose on-screen positions the rotation must move. */
const cornerBlocks = (): GridAsset[] =>
  CORNERS.map(([col, row]) => ({ art: ['#'], col, row, type: 'wall', label: 'wall', height: 1, color: '#8a8a8a' }))

type CameraParam = { cameraTurn: number } | { cameraFacing: Orientation } | Record<string, never>

/** Render one iso frame with the deterministic clamp-free camera, driven by whichever camera param is passed. */
const renderIso = (grid: IsometricGrid, camera: CameraParam = {}, ctx: CanvasRenderingContext2D = mockCtx()): void => {
  render({
    ctx, w: W, h: H, grid, player: player(), time: 0, camOffset: { x: 0, y: 0 }, entities: [],
    enemyCombat: new Map(), hitMarkers: [], now: 0, zoom: 1, attackAnims: [], connectors: [], quests: [],
    projectiles: [], dayNight: 'day', attackReach: 1, style: ASCII_STYLE, clampCamera: false, ...camera,
  })
}

/** The screen ANCHOR (base-diamond centre) of the block drawn at world (col,row) this frame — read back from
 *  the frame's OWN recorded silhouette, so it is literally where the renderer put it. */
const drawnAnchor = (col: number, row: number): { x: number; y: number } => {
  const g = isoRecordedGeom(col, row, 0)
  if (!g || g.kind !== 'cube') throw new Error(`no cube recorded at ${col},${row}`)
  const [left, , right] = g.base
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }
}

/** Where world (col,row) must land at a CONTINUOUS `turn`, derived from first principles and independent of the
 *  renderer: centre the coord on the grid middle, turn it by `turn`×90° CW, then apply today's fixed iso
 *  projection. The camera sits on the grid centre, so the view-frame re-centring cancels out of the offset. */
const expectedScreenAtTurn = (col: number, row: number, turn: number): { x: number; y: number } => {
  const theta = turn * (Math.PI / 2)
  const cos = Math.cos(theta), sin = Math.sin(theta)
  const cu = col - (COLS - 1) / 2, cv = row - (ROWS - 1) / 2
  const wx = (cu * cos - cv * sin) * CELL
  const wz = (cu * sin + cv * cos) * CELL
  return { x: W / 2 + (wx - wz) * ISO * 0.71, y: H / 2 + (wx + wz) * ISO * 0.36 }
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 6): void => {
  expect(a.x).toBeCloseTo(b.x, digits)
  expect(a.y).toBeCloseTo(b.y, digits)
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y)

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('1 — a WHOLE turn is BIT-IDENTICAL to today (the hard regression guard)', () => {
  test('cameraTurn: 0 draws the exact op stream of a render with NO camera param', () => {
    const withoutParam: string[] = [], withZero: string[] = []
    renderIso(gridWith(cornerBlocks()), {}, recordingCtx(withoutParam))
    renderIso(gridWith(cornerBlocks()), { cameraTurn: 0 }, recordingCtx(withZero))
    expect(withoutParam.length).toBeGreaterThan(50) // the frame really drew something
    expect(withZero).toEqual(withoutParam)
  })

  test('cameraTurn: N draws the exact op stream of cameraFacing: N, for ALL FOUR corners', () => {
    for (const facing of WHOLE) {
      const viaFacing: string[] = [], viaTurn: string[] = []
      renderIso(gridWith(cornerBlocks()), { cameraFacing: facing }, recordingCtx(viaFacing))
      renderIso(gridWith(cornerBlocks()), { cameraTurn: facing }, recordingCtx(viaTurn))
      expect(viaFacing.length).toBeGreaterThan(50)
      expect({ facing, ops: viaTurn }).toEqual({ facing, ops: viaFacing })
    }
  })

  test('a turn PAST a full revolution is the same frame as its wrapped corner', () => {
    const at1: string[] = [], at5: string[] = [], atMinus3: string[] = []
    renderIso(gridWith(cornerBlocks()), { cameraTurn: 1 }, recordingCtx(at1))
    renderIso(gridWith(cornerBlocks()), { cameraTurn: 5 }, recordingCtx(at5))
    renderIso(gridWith(cornerBlocks()), { cameraTurn: -3 }, recordingCtx(atMinus3))
    expect(at5).toEqual(at1)
    expect(atMinus3).toEqual(at1)
  })

  test('every corner block sits at the LITERAL screen coords today\'s projection produces, at all 4 corners', () => {
    // The same literals isoCameraRotation.test.ts pins for the 4-way camera — so "bit-identical at rest" is
    // measured against hard-coded pixels, not against the renderer agreeing with itself.
    const literals: Record<number, { x: number; y: number }> = {
      0: { x: 329, y: 192 }, 1: { x: 613, y: 264 }, 2: { x: 471, y: 408 }, 3: { x: 187, y: 336 },
    }
    for (const turn of WHOLE) {
      renderIso(gridWith(cornerBlocks()), { cameraTurn: turn })
      near(drawnAnchor(0, 0), literals[turn])
      for (const [col, row] of CORNERS) near(drawnAnchor(col, row), expectedScreenAtTurn(col, row, turn))
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('2 — a FRACTIONAL turn visibly ROTATES the world', () => {
  test('at turn 0.5 the corner (0,0) sits at the hand-derived 45° position — between its two corners, on the arc', () => {
    renderIso(gridWith(cornerBlocks()), { cameraTurn: 0.5 })
    const a = drawnAnchor(0, 0)
    // Hand-derived: cu=-2, cv=-1, cos=sin=√2/2 → du=-√2/2, dv=-3√2/2 → x=400+(√2)*71, y=300-(2√2)*36.
    near(a, { x: 400 + Math.SQRT2 * 71, y: 300 - 2 * Math.SQRT2 * 36 }, 6)
    near(a, expectedScreenAtTurn(0, 0, 0.5), 6)
    expect(a.x).toBeGreaterThan(329) // genuinely between the facing-0 and facing-1 positions in x …
    expect(a.x).toBeLessThan(613)
    // … and well OFF the straight chord between them: the corner swings along an ARC, which is what makes it
    // read as a world rotating rather than tiles sliding.
    const chordY = 192 + ((a.x - 329) / (613 - 329)) * (264 - 192)
    expect(chordY - a.y).toBeGreaterThan(20)
  })

  test('every corner block lands where the first-principles rotation predicts, at several fractional turns', () => {
    for (const turn of [0.15, 0.5, 0.85, 1.4, 2.6, 3.9]) {
      renderIso(gridWith(cornerBlocks()), { cameraTurn: turn })
      for (const [col, row] of CORNERS) near(drawnAnchor(col, row), expectedScreenAtTurn(col, row, turn), 6)
    }
  })

  test('a sweep 0→1 is a SMOOTH animation: 21 distinct positions, every step small and non-zero', () => {
    const path: { x: number; y: number }[] = []
    for (let i = 0; i <= 20; i++) {
      renderIso(gridWith(cornerBlocks()), { cameraTurn: i / 20 })
      path.push(drawnAnchor(0, 0))
    }
    expect(new Set(path.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`)).size).toBe(21)
    for (let i = 1; i < path.length; i++) {
      const step = dist(path[i - 1], path[i])
      expect({ i, moved: step > 0.5, small: step < 40 }).toEqual({ i, moved: true, small: true })
    }
    near(path[0], expectedScreenAtTurn(0, 0, 0))
    near(path[20], expectedScreenAtTurn(0, 0, 1))
  })

  test('NO JUMP across the 45° nearest-corner crossover (the view-dims swap cancels against the focus)', () => {
    // At 0.5 the nearest corner flips 0→1 and a NON-SQUARE map's view dims swap. The cell and the camera focus
    // are re-centred by the same amount, so the projected pixels must not jump.
    renderIso(gridWith(cornerBlocks()), { cameraTurn: 0.4999 })
    const before = drawnAnchor(0, 0)
    renderIso(gridWith(cornerBlocks()), { cameraTurn: 0.5001 })
    expect(dist(before, drawnAnchor(0, 0))).toBeLessThan(0.5)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('3 — the depth sort MID-TURN uses the CONTINUOUS projected key', () => {
  // Two tiles on the same iso screen column at rest: (1,1) is BEHIND (2,2) at turn 0 and IN FRONT at turn 2.
  // Their screen depths are (viewCol+viewRow), which for a continuous turn is a continuous quantity — so the
  // order must flip exactly where those depths TIE (turn 1 for this pair), NOT at the 0.5 corner crossover.
  const BACK = { col: 1, row: 1, asset: { heightLevel: 0 } }
  const FRONT = { col: 2, row: 2, asset: { heightLevel: 0 } }
  const compareAt = (turn: number): number =>
    isoDepthComparatorFor([BACK, FRONT], COLS, ROWS, turn)(BACK, FRONT)

  test('at the whole corners it is exactly today\'s order', () => {
    expect(compareAt(0)).toBeLessThan(0)    // (1,1) behind
    expect(compareAt(2)).toBeGreaterThan(0) // half a turn → (1,1) in front
  })

  test('mid-turn the order follows the real screen depth, flipping at the geometric tie (turn 1)', () => {
    expect(compareAt(0.5)).toBeLessThan(0) // past the corner crossover, still genuinely behind
    expect(compareAt(0.9)).toBeLessThan(0)
    expect(compareAt(1)).toBe(0)           // the two tiles are at the SAME screen depth here
    expect(compareAt(1.1)).toBeGreaterThan(0)
    expect(compareAt(1.5)).toBeGreaterThan(0)
  })

  test('the RENDER draws in that order — the frontmost tile is drawn LAST', () => {
    const tall = (col: number, row: number): GridAsset =>
      ({ art: ['#'], col, row, type: 'wall', label: 'wall', height: 1, scaleY: 3, color: '#8a8a8a' })
    const topmostOf = (turn: number): { col: number; row: number } => {
      renderIso(gridWith([tall(BACK.col, BACK.row), tall(FRONT.col, FRONT.row)]), { cameraTurn: turn })
      const drawn = renderedTilesInRect(0, 0, W, H) // last-drawn FIRST
        .filter(t => (t.col === BACK.col && t.row === BACK.row) || (t.col === FRONT.col && t.row === FRONT.row))
      expect(drawn.length).toBe(2)
      return { col: drawn[0].col, row: drawn[0].row }
    }
    expect(topmostOf(0)).toEqual({ col: FRONT.col, row: FRONT.row })
    expect(topmostOf(0.9)).toEqual({ col: FRONT.col, row: FRONT.row })
    expect(topmostOf(1.1)).toEqual({ col: BACK.col, row: BACK.row })
    expect(topmostOf(2)).toEqual({ col: BACK.col, row: BACK.row })
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('4 — the PICK still round-trips AT REST (a settled camera is today\'s camera)', () => {
  const camFor = (turn: number) => ({
    w: W, h: H, cellSize: CELL, isoScale: ISO,
    ...isoViewFocus(PCOL, PROW, 0, 0, W / (2 * TILE_W), H / (2 * TILE_H), COLS, ROWS, turn, false),
  })

  test('a click at a corner tile\'s RENDERED position selects THAT world tile, at every whole turn', () => {
    for (const turn of WHOLE) {
      renderIso(gridWith(cornerBlocks()), { cameraTurn: turn })
      for (const [col, row] of CORNERS) {
        const a = drawnAnchor(col, row)
        const hit = pickIsoTileAt(a.x, a.y)
        expect({ turn, col: hit?.col, row: hit?.row }).toEqual({ turn, col, row })
      }
    }
  })

  test('the bare-cell screen↔cell pair is an exact inverse for every cell at every whole turn', () => {
    for (const turn of WHOLE) {
      const cam = camFor(turn)
      for (let col = 0; col < COLS; col++) for (let row = 0; row < ROWS; row++) {
        const p = isoWorldCellToScreen(col, row, cam, COLS, ROWS, turn)
        expect({ turn, ...isoScreenToWorldCell(p.x, p.y, cam, COLS, ROWS, turn) }).toEqual({ turn, col, row })
      }
    }
  })

  test('cell→screen agrees with what the RENDER drew, mid-turn as well as at rest', () => {
    for (const turn of [0, 0.37, 1, 1.5, 3]) {
      renderIso(gridWith(cornerBlocks()), { cameraTurn: turn })
      const cam = camFor(turn)
      for (const [col, row] of CORNERS) near(isoWorldCellToScreen(col, row, cam, COLS, ROWS, turn), drawnAnchor(col, row))
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('5 — the camera-turn seams the UI controller drives', () => {
  type TurnSeam = {
    __setCameraTurn?: (t: number) => number
    __cameraTurn?: () => number
    __setCameraFacing?: (f: Orientation) => Orientation
    __cameraFacing?: () => Orientation
  }
  const seam = (): TurnSeam => window as unknown as TurnSeam

  afterEach(() => { setIsoCameraTurn(0) }) // never leak a turn into another test

  test('render installs __setCameraTurn / __cameraTurn, and a param-less render follows them', () => {
    renderIso(gridWith(cornerBlocks())) // installs the seams
    expect(typeof seam().__setCameraTurn).toBe('function')
    expect(seam().__cameraTurn!()).toBe(0)

    expect(seam().__setCameraTurn!(1.5)).toBe(1.5)
    expect(seam().__cameraTurn!()).toBe(1.5)
    renderIso(gridWith(cornerBlocks())) // NO camera param — the seam drives it
    near(drawnAnchor(0, 0), expectedScreenAtTurn(0, 0, 1.5))
  })

  test('the seam WRAPS, and the module accessors mirror it', () => {
    expect(setIsoCameraTurn(4.25)).toBeCloseTo(0.25, 12)
    expect(isoCameraTurn()).toBeCloseTo(0.25, 12)
    expect(setIsoCameraTurn(-1)).toBe(3)
    expect(isoCameraTurn()).toBe(3)
  })

  test('the 4-way facing seam still works and reports the NEAREST corner of the live turn', () => {
    renderIso(gridWith(cornerBlocks()))
    expect(seam().__setCameraFacing!(2)).toBe(2)
    expect(seam().__cameraFacing!()).toBe(2)
    expect(seam().__cameraTurn!()).toBe(2) // one source of truth: a facing IS a whole turn
    setIsoCameraTurn(2.6)
    expect(isoCameraFacing()).toBe(3)
    renderIso(gridWith(cornerBlocks())) // param-less, mid-spin — the frame follows the TURN, not the corner
    near(drawnAnchor(0, 0), expectedScreenAtTurn(0, 0, 2.6))
  })

  test('an explicit cameraTurn param WINS over the seam, and cameraTurn wins over cameraFacing', () => {
    renderIso(gridWith(cornerBlocks()))
    setIsoCameraTurn(2)
    renderIso(gridWith(cornerBlocks()), { cameraTurn: 0.75 })
    near(drawnAnchor(0, 0), expectedScreenAtTurn(0, 0, 0.75))
    render({
      ctx: mockCtx(), w: W, h: H, grid: gridWith(cornerBlocks()), player: player(), time: 0,
      style: ASCII_STYLE, clampCamera: false, cameraFacing: 1, cameraTurn: 3.25,
    })
    near(drawnAnchor(0, 0), expectedScreenAtTurn(0, 0, 3.25))
  })
})
