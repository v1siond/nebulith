/**
 * Ticket 5 — FLAT compositions (fountain, well) must render their BODY in the 2D front-elevation view, not
 * just in ISO (MAP-MODEL §5 — a composition cell resolves by its own LABEL in EVERY view; RENDER-AND-CAMERA
 * §7 — the 2D front elevation).
 *
 * The bug: `frontElevation` depth-collapse kept only the FRONT-most cell per (col, heightLevel). A building
 * survives that because its facade has real HEIGHT (walls stack level 0..N). But a FLAT composition — the
 * fountain / well, whose cells all sit at level 0 but span depth — collapsed to its single front rim row, so
 * every interior WATER cell (the whole point of the fountain, and the cells that carry the grow animation)
 * hid behind the front rim. In 2D the fountain read as a bare strip of stone.
 *
 * The fix: collapse by OCCLUSION — hide a cell only when a cell IN FRONT of it is at LEAST as tall. Equal-
 * height rows (a wall column, a back wall behind a door) still dedupe to the front-most; a TALLER cell behind
 * a SHORT one (the water, which grows 1→4 blocks over its 1-block rim) survives and draws above the front
 * face. These assert the module behaviour end-to-end (positive: the water renders; negative: buildings still
 * depth-collapse, equal-height rows still dedupe) — no pixels, GEOMETRY + the real render's drawn-cell record.
 */
import { styleCatalog } from '@/engine/tileset/styleTiles'
import '@/__tests__/helpers/installTilesetSeed'
import { render2D } from '@/engine/render/topdown'
import { frontElevation } from '@/engine/render/frontElevation'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { stampComposition, stampBuildingComposition } from '@/game/runtime/composition'
import { resolveComposition } from '@/engine/tileset/tileset'
import type { PlayerState } from '@/game/runtime/player'

const CELL = 16
const FACADE_OVERLAY = 'rgba(0, 0, 0, 0.45)' // draw2DLabeledCell stamps this on every facade cell it draws

interface Rect { x: number; y: number; w: number; h: number; style: string }
function recordingCtx() {
  const rects: Rect[] = []
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline, lineWidth: 1, lineCap: '' as CanvasLineCap, globalAlpha: 1,
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setLineDash() {},
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arc() {},
    ellipse() {}, closePath() {}, fill() {}, stroke() {}, clip() {}, rect() {}, drawImage() {},
    createLinearGradient() { return { addColorStop() {} } }, createRadialGradient() { return { addColorStop() {} } },
    fillRect(x: number, y: number, w: number, h: number) { rects.push({ x, y, w, h, style: String(this.fillStyle) }) },
    strokeRect() {}, fillText() {}, strokeText() {}, measureText() { return { width: 10 } as TextMetrics },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects }
}
const grid40 = (): IsometricGrid => new IsometricGrid({ cols: 40, rows: 40, cellSize: CELL, isoScale: 1 })
const player = (): PlayerState => ({ x: 20 * CELL, z: 20 * CELL, moving: false } as PlayerState)
const drawFacade = (grid: IsometricGrid): Rect[] => {
  const { ctx, rects } = recordingCtx()
  render2D({ ctx, w: 640, h: 640, grid, player: player(), time: 0 })
  return rects.filter(r => r.style === FACADE_OVERLAY)
}

describe('flat compositions (fountain / well) render their body in the 2D front elevation', () => {
  for (const kind of ['fountain', 'well'] as const) {
    test(`${kind}: the interior WATER survives the depth-collapse (not hidden behind the front rim)`, () => {
      const grid = grid40()
      const placed = stampComposition(grid, kind, 18, 18, 'spring')
      expect(placed).toBeGreaterThan(0)

      const cells = grid.assets.filter(a => a.type === kind)
      const water = cells.filter(a => a.label === 'water_c')
      expect(water.length).toBeGreaterThan(0) // sanity: the fixture fountain/well has interior water

      const fe = frontElevation(grid.assets)
      const waterDrawn = water.filter(a => fe.draw.has(a))
      const waterHidden = water.filter(a => fe.hidden.has(a))
      // POSITIVE — at least the animated water (the grow-track cells) survives; none of them is the old
      // "all water hidden" state. Every water cell is accounted for (drawn or explicitly hidden, none lost).
      expect(waterDrawn.length).toBeGreaterThan(0)
      expect(waterDrawn.length + waterHidden.length).toBe(water.length)

      // The animated water cells (they carry the grow animation → they are the tall columns) MUST be kept:
      // being the tallest thing in their screen column, nothing in front can occlude them.
      const animatedWater = water.filter(a => (a.animations?.length ?? 0) > 0)
      expect(animatedWater.length).toBeGreaterThan(0)
      for (const a of animatedWater) expect(fe.draw.has(a)).toBe(true)
    })

    test(`${kind}: render2D draws MORE than just the front rim row (the body is visible)`, () => {
      const grid = grid40()
      stampComposition(grid, kind, 18, 18, 'spring')
      const comp = resolveComposition(styleCatalog('ascii'), kind)!
      const frontRowWidth = comp.footprint.w // the front rim is one row = footprint width cells

      const facade = drawFacade(grid)
      // Before the fix render2D drew exactly `frontRowWidth` cells (the rim strip). Now the water body adds
      // more, so the drawn facade count exceeds the bare front row.
      expect(facade.length).toBeGreaterThan(frontRowWidth)
    })
  }

  test('AUDIT — every composition in the tileset renders at least one facade cell in 2D', () => {
    const missing: string[] = []
    for (const kind of Object.keys(styleCatalog('ascii').compositions)) {
      const grid = grid40()
      // Every composition (building, tree, fountain, well, lamp, bush) stamps by kind through the ONE generic
      // per-cell path and must project at least one facade cell in the 2D view.
      const placed = stampComposition(grid, kind, 16, 16, 'spring')
      if (placed === 0) continue // a kind with no cells in this tileset — nothing to render, not a drop
      const facade = drawFacade(grid)
      if (facade.length === 0) missing.push(kind)
    }
    expect(missing).toEqual([])
  })
})

describe('buildings still depth-collapse (the occlusion rule did NOT un-collapse the facade)', () => {
  test('a back-row wall behind the front face at EQUAL height is still hidden', () => {
    const grid = grid40()
    stampBuildingComposition(grid, 'house', 4, 19, 19, 'spring', 'south')
    const fe = frontElevation(grid.assets)

    // Depth was genuinely removed: something is hidden, and no (col,level) keeps two EQUAL-height cells.
    expect(fe.hidden.size).toBeGreaterThan(0)
    for (const a of fe.draw.keys()) {
      const sameColLevel = [...fe.draw.keys()].filter(
        o => o !== a && o.col === a.col && (o.heightLevel ?? 0) === (a.heightLevel ?? 0),
      )
      // Any co-located kept cell must be a genuinely TALLER one (never an equal-height duplicate row).
      for (const o of sameColLevel) {
        const ha = (a.height ?? 1) * (a.scaleY ?? 1) * (a.scale ?? 1)
        const ho = (o.height ?? 1) * (o.scaleY ?? 1) * (o.scale ?? 1)
        expect(ha).not.toBeCloseTo(ho, 5)
      }
    }
  })

  test('an all-equal-height flat run collapses to ONE cell (edge column dedupes, not the fountain body)', () => {
    // A synthetic 1-wide × 4-deep column of identical flat cells — like a fountain edge rim (all height 1).
    const col: GridAsset[] = [0, 1, 2, 3].map(dy =>
      ({ art: ['#'], col: 5, row: 5 + dy, type: 'rim', label: 'fountain_l', height: 1, heightLevel: 0 } as GridAsset),
    )
    const { draw, hidden } = frontElevation(col)
    expect(draw.size).toBe(1)          // exactly the front-most survives
    expect(hidden.size).toBe(3)        // the three equal-height cells behind it are occluded
    const kept = [...draw.keys()][0]
    expect(kept.row).toBe(8)           // the FRONT-most (max) row
    expect(draw.get(kept)!.anchorRow).toBe(8)
  })
})
