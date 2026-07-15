/**
 * Step 4b parity — the ISO ground layer's FLOOR now reads tile index 0 of the cell's unified stack
 * (getStack) instead of grid.ground/groundColor/groundDims directly. This MUST be pixel-identical: the
 * floor TileEntry projects the SAME slug/colour/dims, so resolveGroundTile / cellFill / the dims path all
 * resolve to the same iso diamond fills + glyphs. Mirrors src/__tests__/engine/topdownFloorStack.test.ts
 * (Step 4a), on the iso path.
 *
 * We drive the REAL drawIsoGroundLayer through a recording ctx and assert the diamond-TOP fill it stamps
 * for a cell equals the LEGACY direct-read formula (recomputed here from the SAME public helpers the
 * renderer uses) — a genuine "same draw list" proof, not "it drew something":
 *   A. a bare GRASS cell → its per-cell grassShade fill, at the exact diamond-top vertex;
 *   B. a per-cell COLOUR override → that exact colour on its cell (neighbours unaffected);
 *   C. a NON-grass floor (rock) → the raw catalog bg, NOT grass-shaded;
 *   D. the dims RECONSTRUCTION {scaleX:floor.w,scaleY:floor.scaleY,scaleZ:floor.d,scale:floor.zoom,pose}
 *      is byte-identical THROUGH groundDimsActive + groundSizeFactors to the old grid.groundDims read —
 *      the exact contract drawIsoGroundContent consumes (unset → inactive/{1,1}; scaled/posed → same);
 *   E. source parity — getStack[0].slug || 'grass' === grid.ground read; getStack[0].color ?? undefined
 *      === grid.groundColor read (the two substitutions the diff made).
 *
 * Geometry is deterministic: camX=camZ=0, isoScale=1, cellSize=16 → tileW=11.36, tileH=5.76. All heights
 * are 0 and every scanned cell is interior, so NO cube side-faces are drawn (leftOpen/rightOpen both
 * false) — the ONLY path-fill per cell is its diamond top, at (px, py - tileH), a closed form per cell.
 */
import '@/__tests__/helpers/installTilesetSeed' // ground terrain comes from the loaded backend tileset now — install the captured fixture so resolveGroundTile isn't empty
import { drawIsoGroundLayer, type IsoGroundParams } from '@/engine/render/iso'
import { getStack } from '@/engine/cellStack'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { ASCII_STYLE, groundKind } from '@/game/artStyle'
import { resolveGroundTile } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { grassShade, cellFill } from '@/engine/render/shared'
import { groundSizeFactors, groundDimsActive, type GroundCellDims } from '@/engine/groundDims'

interface Fill { x: number; y: number; style: string }

// Records every path fill() with the first moveTo vertex since the last beginPath (so the diamond top,
// whose first vertex is (px, drawY - tileH), is addressable per cell). ASCII ground content is a plain
// fillText — captured separately so it never masquerades as the diamond fill.
function recordingCtx() {
  const fills: Fill[] = []
  let cur: { x: number; y: number } | null = null
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline, lineWidth: 1, globalAlpha: 1,
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, transform() {}, setLineDash() {},
    beginPath() { cur = null },
    moveTo(x: number, y: number) { if (!cur) cur = { x, y } },
    lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arc() {}, ellipse() {}, closePath() {}, clip() {}, rect() {},
    fill() { if (cur) fills.push({ x: cur.x, y: cur.y, style: String(this.fillStyle) }) },
    stroke() {}, strokeRect() {}, fillRect() {}, fillText() {}, strokeText() {},
    createLinearGradient() { return { addColorStop() {} } }, createRadialGradient() { return { addColorStop() {} } },
    drawImage() {}, measureText() { return { width: 8 } as TextMetrics },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills }
}

const CELL = 16, W = 800, H = 800, ISO = 1
const tileW = CELL * ISO * 0.71
const tileH = CELL * ISO * 0.36
const heightStep = CELL * ISO * 0.4
const grid40 = (): IsometricGrid => new IsometricGrid({ cols: 40, rows: 40, cellSize: CELL, isoScale: ISO })

const params = (grid: IsometricGrid): IsoGroundParams => ({
  grid, w: W, h: H, time: 0, camX: 0, camZ: 0, isoScale: ISO, cellSize: CELL,
  tileW, tileH, heightStep, cubeDepth: tileH * 1.6,
  startCol: 0, endCol: 8, startRow: 0, endRow: 8,
  groundFontSize: Math.max(12, tileH * 1.1), style: ASCII_STYLE,
})

// The diamond-TOP vertex the renderer's moveTo stamps for a (col,row), computed with the SAME projection.
const diamondTop = (grid: IsometricGrid, col: number, row: number): { x: number; y: number } => {
  const wx = col * CELL, wz = row * CELL // camX=camZ=0
  const px = W / 2 + (wx - wz) * ISO * 0.71
  const py = H / 2 + (wx + wz) * ISO * 0.36
  const drawY = py - grid.getHeight(col, row) * heightStep
  return { x: px, y: drawY - tileH }
}
const diamondFill = (fills: Fill[], grid: IsometricGrid, col: number, row: number): Fill | undefined => {
  const t = diamondTop(grid, col, row)
  return fills.find(f => Math.abs(f.x - t.x) < 1e-6 && Math.abs(f.y - t.y) < 1e-6)
}

// The LEGACY iso ground fill for a cell, recomputed from the direct grid reads the migration replaced
// (ASCII → resolveDraw tint is undefined, so cellFill sees tint=undefined; an override wins first).
const legacyFill = (grid: IsometricGrid, col: number, row: number): string => {
  const tileType = grid.ground[row]?.[col] || 'grass'
  const gt = resolveGroundTile(ASCII_TILESET, tileType, col, row)
  const isGrass = tileType.includes('grass')
  const bg = isGrass ? grassShade(gt.bg, col, row) : gt.bg
  const gk = groundKind(tileType)
  return grid.groundColor?.[row]?.[col] ?? cellFill(undefined, bg, isGrass || gk === 'cavefloor', col, row)
}

describe('Step 4b — drawIsoGroundLayer floor reads the unified stack (index 0), pixel-identical to the direct read', () => {
  test('A — a bare GRASS cell paints its exact legacy grassShade fill at the diamond top', () => {
    const grid = grid40()
    const { ctx, fills } = recordingCtx()
    drawIsoGroundLayer(ctx, params(grid), true, [])

    const f = diamondFill(fills, grid, 4, 4)
    expect(f).toBeDefined()
    expect(f!.style).toBe(legacyFill(grid, 4, 4))
    // Sanity: the recomputed fill IS the grass shade (not a raw/flat bg), so this really exercises grass.
    expect(f!.style).toBe(grassShade(resolveGroundTile(ASCII_TILESET, 'grass', 4, 4).bg, 4, 4))
  })

  test('B — a per-cell COLOUR override rides the floor tile; neighbours keep their grass fill', () => {
    const grid = grid40()
    const OVERRIDE = '#abcdef'
    grid.setGroundColor(4, 4, OVERRIDE)
    const { ctx, fills } = recordingCtx()
    drawIsoGroundLayer(ctx, params(grid), true, [])

    expect(diamondFill(fills, grid, 4, 4)!.style).toBe(OVERRIDE)
    expect(diamondFill(fills, grid, 4, 4)!.style).toBe(legacyFill(grid, 4, 4))
    // A neighbour with no override still paints grass (the override didn't leak).
    expect(diamondFill(fills, grid, 5, 4)!.style).not.toBe(OVERRIDE)
    expect(diamondFill(fills, grid, 5, 4)!.style).toBe(legacyFill(grid, 5, 4))
  })

  test('C — a NON-grass floor (rock) paints the raw catalog bg, never grass-shaded', () => {
    const grid = grid40()
    grid.setGround(4, 4, 'rock')
    const { ctx, fills } = recordingCtx()
    drawIsoGroundLayer(ctx, params(grid), true, [])

    const f = diamondFill(fills, grid, 4, 4)
    const rawBg = resolveGroundTile(ASCII_TILESET, 'rock', 4, 4).bg
    expect(f!.style).toBe(legacyFill(grid, 4, 4))
    expect(f!.style).toBe(rawBg) // rock is neither grass nor cavefloor → the raw catalog bg
    expect(f!.style).not.toBe(grassShade(rawBg, 4, 4))
  })

  test('D — dims reconstruction is byte-identical through groundDimsActive + groundSizeFactors', () => {
    const cases: Array<Partial<GroundCellDims> | undefined> = [
      undefined,                       // no dims → the reconstruction must resolve to inactive / {1,1}
      { scaleX: 2 },                   // Width only
      { scaleZ: 3, scale: 1.5 },       // Depth × Zoom
      { scaleY: 2 },                   // Height — no axis, but still counts as active (persists)
      { pose: { dx: 0.5, rot: 15 } },  // pose only
    ]
    for (const dims of cases) {
      const grid = grid40()
      if (dims) grid.setGroundDims(6, 6, dims)
      const floor = getStack(grid, 6, 6)[0]
      const recon: GroundCellDims = { scaleX: floor.w, scaleY: floor.scaleY, scaleZ: floor.d, scale: floor.zoom, pose: floor.pose }
      const legacy = grid.groundDims?.[6]?.[6] // the read the migration replaced (undefined when unset)

      expect(groundDimsActive(recon)).toBe(groundDimsActive(legacy))
      expect(groundSizeFactors(recon)).toEqual(groundSizeFactors(legacy))
      expect(recon.pose).toEqual(legacy?.pose)
    }
  })

  test('E — source parity: getStack[0].slug/color reproduce the exact grid.ground/groundColor reads', () => {
    const grid = grid40()
    grid.setGround(2, 2, 'rock')
    grid.setGroundColor(3, 3, '#123456')
    for (const [col, row] of [[2, 2], [3, 3], [7, 7]] as const) {
      const floor = getStack(grid, col, row)[0]
      expect(floor.slug || 'grass').toBe(grid.ground[row]?.[col] || 'grass')
      expect(floor.color ?? undefined).toBe(grid.groundColor?.[row]?.[col] ?? undefined)
    }
  })
})
