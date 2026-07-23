/**
 * 4-WAY HORIZONTAL CAMERA ROTATION IN ISO (ticket #75) — end-to-end through render().
 *
 * Alexander: "the rotate button or action … just rotates the map horizontally, changing the front perspective
 * of the map and showing a different side of it" / "we can rotate the corners, 4 corners, 4 rotation options,
 * all faces of the map are visible" — the reason being that "tiles that aren't in the front side from the
 * camera perspective are hard to select, specially with collisions on".
 *
 * So this file asserts what makes the feature real, against the RENDERED frame (not the pure math —
 * `isoOrientation.test.ts` already covers that):
 *   1. `cameraFacing: 0` is inert — the frame is identical to today's un-rotated render (op stream + the
 *      hard-coded screen coords today's projection produces).
 *   2. Each facing lands a KNOWN corner tile at a DIFFERENT, PREDICTED screen position, and a DIFFERENT world
 *      corner becomes the FRONT (nearest-camera) one — i.e. all four map faces become reachable.
 *   3. The PICK round-trips at every facing: a click at a tile's rendered position selects THAT world tile,
 *      through the recorded silhouettes AND through the flat bare-cell screen↔cell pair.
 *   4. A depth/`depthDir` span (a roof) stays GRID-ALIGNED under rotation — its covered cells rotate with it.
 *   5. OCCLUSION sorts in the view frame, the camera CLAMP uses the ORIENTED dims, and the `__setCameraFacing`
 *      seam drives a param-less render.
 *
 * Deterministic camera idiom copied from isoInvertedPick.test.ts: cellSize 100 / isoScale 1 (tileW 71,
 * tileH 36) and clampCamera:false, so every expected pixel is exact.
 */
import '@/__tests__/helpers/installTilesetSeed'
import {
  render, pickIsoTileAt, pickIsoTilesAt, isoRecordedGeom, ISO_BLOCK_H_FRAC, isoViewFocus,
  isoWorldCellToScreen, isoScreenToWorldCell,
} from '@/engine/render/iso'
import { orientCell, type Orientation } from '@/engine/render/isoOrientation'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { ASCII_STYLE } from '@/game/artStyle'
import type { PlayerState } from '@/game/runtime/player'

const CELL = 100, W = 800, H = 600, ISO = 1
const TILE_W = CELL * ISO * 0.71, TILE_H = CELL * ISO * 0.36
// A deliberately NON-SQUARE map: an odd facing swaps the view dims, so a dims bug can't hide behind a square.
const COLS = 5, ROWS = 3
// The player sits on the map CENTRE, which is its own centre in every oriented frame — so the four facings are
// a clean turn about the middle and the expected pixels below are exact.
const PCOL = 2, PROW = 1
const FACINGS: Orientation[] = [0, 1, 2, 3]
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

/** A ctx that LOGS every draw call + style write, so two frames can be compared operation-for-operation. */
function recordingCtx(log: string[]): CanvasRenderingContext2D {
  const base = mockCtx() as unknown as Record<string, unknown>
  const target: Record<string, unknown> = {}
  for (const key of Object.keys(base)) {
    const v = base[key]
    target[key] = typeof v === 'function'
      ? (...args: unknown[]) => { log.push(`${key}(${args.map(a => (typeof a === 'number' ? a.toFixed(4) : String(a))).join(',')})`); return (v as (...a: unknown[]) => unknown).apply(target, args) }
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

/** Render one iso frame with the deterministic clamp-free camera. `facing` omitted → today's call shape. */
const renderIso = (grid: IsometricGrid, facing?: Orientation, ctx: CanvasRenderingContext2D = mockCtx()): void => {
  render({
    ctx, w: W, h: H, grid, player: player(), time: 0, camOffset: { x: 0, y: 0 }, entities: [],
    enemyCombat: new Map(), hitMarkers: [], now: 0, zoom: 1, attackAnims: [], connectors: [], quests: [],
    projectiles: [], dayNight: 'day', attackReach: 1, style: ASCII_STYLE, clampCamera: false,
    ...(facing === undefined ? {} : { cameraFacing: facing }),
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

/** The screen position the FIXED iso projection gives a VIEW-frame coord, with the camera on the map centre.
 *  This is today's untouched projection, written out independently of the renderer. */
const projectView = (viewCol: number, viewRow: number, camCol: number, camRow: number): { x: number; y: number } => {
  const wx = viewCol * CELL - camCol * CELL
  const wz = viewRow * CELL - camRow * CELL
  return { x: W / 2 + (wx - wz) * ISO * 0.71, y: H / 2 + (wx + wz) * ISO * 0.36 }
}

/** Where world (col,row) must land at `facing`: rotate the coord into the view frame (the pure, separately
 *  tested `orientCell`), rotate the camera focus the same way, then project. */
const expectedScreen = (col: number, row: number, facing: Orientation): { x: number; y: number } => {
  const v = orientCell(col, row, COLS, ROWS, facing)
  const cam = orientCell(PCOL, PROW, COLS, ROWS, facing)
  return projectView(v.col, v.row, cam.col, cam.row)
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
  expect(a.x).toBeCloseTo(b.x, 6)
  expect(a.y).toBeCloseTo(b.y, 6)
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('1 — cameraFacing 0 is INERT (regression guard: today\'s frame, unchanged)', () => {
  test('the op stream with cameraFacing:0 is identical to the frame drawn WITHOUT the param', () => {
    const withoutParam: string[] = []
    const withZero: string[] = []
    renderIso(gridWith(cornerBlocks()), undefined, recordingCtx(withoutParam))
    renderIso(gridWith(cornerBlocks()), 0, recordingCtx(withZero))
    expect(withoutParam.length).toBeGreaterThan(50) // the frame really drew something
    expect(withZero).toEqual(withoutParam)
  })

  test('at facing 0 every corner block sits at the LITERAL screen coords today\'s projection produces', () => {
    renderIso(gridWith(cornerBlocks()), 0)
    // Hand-derived from the un-rotated formula (camera on the map centre, cell 100, isoScale 1):
    near(drawnAnchor(0, 0), { x: 329, y: 192 })
    near(drawnAnchor(4, 0), { x: 613, y: 336 })
    near(drawnAnchor(4, 2), { x: 471, y: 408 })
    near(drawnAnchor(0, 2), { x: 187, y: 264 })
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('2 — each facing shows a DIFFERENT side of the map', () => {
  test('the corner block (0,0) lands at four DISTINCT, predicted screen positions', () => {
    // Literals, so this can never degenerate into "the renderer agrees with itself".
    const expected = [{ x: 329, y: 192 }, { x: 613, y: 264 }, { x: 471, y: 408 }, { x: 187, y: 336 }]
    const seen: string[] = []
    for (const facing of FACINGS) {
      renderIso(gridWith(cornerBlocks()), facing)
      const a = drawnAnchor(0, 0)
      near(a, expected[facing])
      seen.push(`${a.x.toFixed(2)},${a.y.toFixed(2)}`)
    }
    expect(new Set(seen).size).toBe(4) // four rotations, four different places on screen
  })

  test('every corner block lands where orientCell predicts, at every facing', () => {
    for (const facing of FACINGS) {
      renderIso(gridWith(cornerBlocks()), facing)
      for (const [col, row] of CORNERS) near(drawnAnchor(col, row), expectedScreen(col, row, facing))
    }
  })

  test('a DIFFERENT world corner becomes the FRONT (nearest-camera) one at each facing — all 4 faces reachable', () => {
    const fronts: string[] = []
    for (const facing of FACINGS) {
      renderIso(gridWith(cornerBlocks()), facing)
      // Nearest the camera = lowest on screen (the iso front/bottom corner).
      const front = CORNERS.reduce((best, c) => (drawnAnchor(c[0], c[1]).y > drawnAnchor(best[0], best[1]).y ? c : best))
      fronts.push(front.join(','))
    }
    expect(fronts).toEqual(['4,2', '4,0', '0,0', '0,2']) // one CW step per facing, right around the map
    expect(new Set(fronts).size).toBe(4)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('3 — the PICK round-trips at every facing (the whole point: reach the hidden side)', () => {
  test('a click at a corner tile\'s RENDERED position selects THAT world tile, for all 4 facings', () => {
    for (const facing of FACINGS) {
      renderIso(gridWith(cornerBlocks()), facing)
      for (const [col, row] of CORNERS) {
        const a = drawnAnchor(col, row)
        const hit = pickIsoTileAt(a.x, a.y)
        expect(hit).not.toBeNull()
        expect({ facing, col: hit!.col, row: hit!.row }).toEqual({ facing, col, row })
      }
    }
  })

  test('the back-side tile that is UNREACHABLE-looking at facing 0 is picked at its own spot after rotating', () => {
    // (0,0) is the BACKMOST corner at facing 0 and the FRONTMOST at facing 2 — the tile the user could not get to.
    renderIso(gridWith(cornerBlocks()), 2)
    const a = drawnAnchor(0, 0)
    const hit = pickIsoTileAt(a.x, a.y)
    expect(hit && { col: hit.col, row: hit.row }).toEqual({ col: 0, row: 0 })
    // (0,0) also LEFT its old spot: the pixel it occupied at facing 0 now belongs to the OPPOSITE corner,
    // (4,2) — a half turn really did swap the two ends of the map, it isn't just the same frame re-labelled.
    const swapped = pickIsoTileAt(329, 192)
    expect(swapped && { col: swapped.col, row: swapped.row }).toEqual({ col: COLS - 1, row: ROWS - 1 })
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('4 — a depth/depthDir span (a roof) stays GRID-ALIGNED under rotation', () => {
  const SPAN = 3
  const ANCHOR: [number, number] = [1, 0]
  // A roof column authored along +row ('left-down'), the axis TILESET-AUTHORING §3 collapses a gable into.
  const roof = (): GridAsset[] => [{
    art: ['#'], col: ANCHOR[0], row: ANCHOR[1], type: 'roof', label: 'roof', height: 1,
    depth: SPAN, depthDir: 'left-down', color: '#a33',
  }]
  const BLOCK_H = TILE_W * ISO_BLOCK_H_FRAC

  test('the span covers the SAME WORLD cells at every facing — picked at each cell\'s rotated position', () => {
    for (const facing of FACINGS) {
      renderIso(gridWith(roof()), facing)
      for (let k = 0; k < SPAN; k++) {
        const covered = expectedScreen(ANCHOR[0], ANCHOR[1] + k, facing) // world cell (1, 0+k), rotated
        const hit = pickIsoTileAt(covered.x, covered.y - BLOCK_H / 2)    // mid-height over that cell
        expect({ facing, k, hit: hit && { col: hit.col, row: hit.row } }).toEqual({ facing, k, hit: { col: ANCHOR[0], row: ANCHOR[1] } })
      }
    }
  })

  test('the span does NOT run along the un-rotated screen axis (the depthDir really rotated)', () => {
    // At facing 1 the +row world axis appears as the −col screen diagonal. If depthDir were left un-rotated the
    // box would still extrude down-left from the anchor and cover THIS point instead.
    renderIso(gridWith(roof()), 1)
    const a = expectedScreen(ANCHOR[0], ANCHOR[1], 1)
    const staleEnd = { x: a.x - (SPAN - 1) * TILE_W, y: a.y + (SPAN - 1) * TILE_H } // 'left-down' in SCREEN space
    expect(pickIsoTileAt(staleEnd.x, staleEnd.y - BLOCK_H / 2)).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('OCCLUSION follows the rotated camera (the painter sorts in the VIEW frame)', () => {
  // Two tall blocks on the same iso screen column: (1,1) sits BEHIND (2,2) at facing 0. A half turn reverses
  // depth, so (1,1) must then draw IN FRONT — if the painter kept sorting by the world (col+row) the rotated
  // map would render inside-out and a click would keep hitting the tile that is now behind.
  const SCALE_Y = 3
  const BACK: [number, number] = [1, 1]
  const FRONT: [number, number] = [2, 2]
  const pair = (): GridAsset[] => [BACK, FRONT].map(([col, row]) => (
    { art: ['#'], col, row, type: 'wall', label: 'wall', height: 1, scaleY: SCALE_Y, color: '#8a8a8a' }
  ))

  const topmostOverBoth = (facing: Orientation): { col: number; row: number } => {
    renderIso(gridWith(pair()), facing)
    const a = drawnAnchor(BACK[0], BACK[1])
    const hits = pickIsoTilesAt(a.x, a.y - 100) // a pixel both silhouettes cover
    expect(hits.length).toBe(2) // the sample really is over BOTH tiles, so the ORDER is what's under test
    return { col: hits[0].col, row: hits[0].row }
  }

  test('facing 0 draws (2,2) on top; facing 2 flips it to (1,1)', () => {
    expect(topmostOverBoth(0)).toEqual({ col: FRONT[0], row: FRONT[1] })
    expect(topmostOverBoth(2)).toEqual({ col: BACK[0], row: BACK[1] })
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('the __setCameraFacing window seam (what the rotate button drives until the UI owns it)', () => {
  type FacingSeam = { __setCameraFacing?: (f: Orientation) => Orientation; __cameraFacing?: () => Orientation }
  const seam = (): FacingSeam => window as unknown as FacingSeam

  afterEach(() => { seam().__setCameraFacing?.(0) }) // never leak a facing into another test

  test('render installs it, and a param-less render then follows whatever it was set to', () => {
    renderIso(gridWith(cornerBlocks())) // installs the seam
    expect(typeof seam().__setCameraFacing).toBe('function')
    expect(seam().__cameraFacing!()).toBe(0)

    seam().__setCameraFacing!(2)
    expect(seam().__cameraFacing!()).toBe(2)
    renderIso(gridWith(cornerBlocks())) // NO cameraFacing param — the seam drives it
    near(drawnAnchor(0, 0), expectedScreen(0, 0, 2))
  })

  test('an explicit cameraFacing param WINS over the seam', () => {
    renderIso(gridWith(cornerBlocks()))
    seam().__setCameraFacing!(2)
    renderIso(gridWith(cornerBlocks()), 1)
    near(drawnAnchor(0, 0), expectedScreen(0, 0, 1))
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('the FLAT (bare-cell) screen↔cell pair — the editor\'s fallback when no tile is under the pointer', () => {
  // The inverted picker handles any cell that DREW a tile; a bare cell falls back to inverting the diamond,
  // which must go back through deorientCell or a rotated camera would select a mirrored/transposed cell.
  // The camera these take is the VIEW-frame focus — the SAME `isoViewFocus` the render resolves, which is the
  // whole point of exporting it: the click and the pixels read one camera, so they cannot drift apart.
  const camFor = (facing: Orientation) => ({
    w: W, h: H, cellSize: CELL, isoScale: ISO,
    ...isoViewFocus(PCOL, PROW, W / (2 * TILE_W), H / (2 * TILE_H), COLS, ROWS, facing, false),
  })

  test('screen→cell is the EXACT inverse of cell→screen, for every cell at every facing', () => {
    for (const facing of FACINGS) {
      const cam = camFor(facing)
      for (let col = 0; col < COLS; col++) {
        for (let row = 0; row < ROWS; row++) {
          const p = isoWorldCellToScreen(col, row, cam, COLS, ROWS, facing)
          expect({ facing, ...isoScreenToWorldCell(p.x, p.y, cam, COLS, ROWS, facing) }).toEqual({ facing, col, row })
        }
      }
    }
  })

  test('cell→screen agrees with what the RENDER actually drew, at every facing', () => {
    for (const facing of FACINGS) {
      renderIso(gridWith(cornerBlocks()), facing)
      const cam = camFor(facing)
      for (const [col, row] of CORNERS) near(isoWorldCellToScreen(col, row, cam, COLS, ROWS, facing), drawnAnchor(col, row))
    }
  })

  test('a rotated camera resolves the SAME pixel to a DIFFERENT world cell (the deorient really runs)', () => {
    // The viewport centre is always the camera's own cell — world (2,1) — at every facing; a NEIGHBOURING
    // pixel, though, belongs to a different world cell each time the map turns.
    const offCentre = { x: W / 2 + TILE_W, y: H / 2 }
    const resolved = FACINGS.map(f => JSON.stringify(isoScreenToWorldCell(offCentre.x, offCentre.y, camFor(f), COLS, ROWS, f)))
    expect(isoScreenToWorldCell(W / 2, H / 2, camFor(0), COLS, ROWS, 0)).toEqual({ col: PCOL, row: PROW })
    expect(new Set(resolved).size).toBe(4)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('5 — the camera CLAMP is computed in the ORIENTED frame', () => {
  // A long, thin map: the view dims SWAP on an odd facing, so clamping with the un-swapped dims throws the
  // camera thousands of pixels off the map.
  const BIG_COLS = 60, BIG_ROWS = 20
  const cornerTile: GridAsset = { art: ['#'], col: BIG_COLS - 1, row: BIG_ROWS - 1, type: 'wall', label: 'wall', height: 1, color: '#8a8a8a' }

  test('with clampCamera on, the followed corner tile stays on screen at every facing', () => {
    for (const facing of FACINGS) {
      const grid = new IsometricGrid({ cols: BIG_COLS, rows: BIG_ROWS, cellSize: CELL, isoScale: ISO })
      grid.setAssets([cornerTile])
      render({
        ctx: mockCtx(), w: W, h: H, grid,
        player: { x: (BIG_COLS - 1) * CELL, z: (BIG_ROWS - 1) * CELL, moving: false } as PlayerState,
        time: 0, camOffset: { x: 0, y: 0 }, entities: [], enemyCombat: new Map(), hitMarkers: [], now: 0,
        zoom: 1, attackAnims: [], connectors: [], quests: [], projectiles: [], dayNight: 'day',
        attackReach: 1, style: ASCII_STYLE, clampCamera: true, cameraFacing: facing,
      })
      const a = drawnAnchor(BIG_COLS - 1, BIG_ROWS - 1)
      expect({ facing, onScreenX: a.x >= -TILE_W && a.x <= W + TILE_W }).toEqual({ facing, onScreenX: true })
      expect({ facing, onScreenY: a.y >= -TILE_H * 8 && a.y <= H + TILE_H * 8 }).toEqual({ facing, onScreenY: true })
    }
  })
})
