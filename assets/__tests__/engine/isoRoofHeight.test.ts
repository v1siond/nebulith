/**
 * Roof HEIGHT in iso — the user's fix: "the roof doesn't have any height right now, which is not good, it
 * should match the size it has on 2d. so if we have a roof of 2 cells height, then that translates to
 * isometric too, right now is flat." BOTH roof types must rise ROOF_ROWS blocks above the walls — the
 * PEAKED gable's ridge AND the BOX (extruded) roof's top — neither is a height-0 flat lid at the eaves.
 *
 * Also guards Task 2: store + hospital roll a SEEDED peaked-vs-box roof, and the 2D + iso renders read the
 * SAME choice for a building (both derive `peaked` from the composed cells), so they can never disagree.
 */
import { drawIsoBuildingTiles, ROOF_ROWS, type Pt } from '@/engine/render/iso'
import { makeBuilding, buildingRect } from '@/engine/buildingEditor'
import { composeBuilding } from '@/engine/buildingComposer'
import { EMOJI_STYLE } from '@/game/artStyle'
import type { GridBuilding } from '@/engine/IsometricGrid'

// A recording ctx that captures every filled polygon (fillQuad → beginPath/moveTo/lineTo…/fill) as its
// vertices, so we can measure how high the drawn geometry reaches. The iso building draws its wall + roof
// faces through fillQuad, so the topmost (min screen-y) vertex is the roof's peak / box-top.
function recordingCtx() {
  const polys: Pt[][] = []
  let cur: Pt[] = []
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', lineWidth: 1, globalAlpha: 1,
    textAlign: '' as CanvasTextAlign, textBaseline: '' as CanvasTextBaseline,
    save() {}, restore() {}, closePath() {}, clip() {}, stroke() {}, ellipse() {}, rect() {},
    transform() {}, fillRect() {}, fillText() {}, drawImage() {}, measureText() { return { width: 10 } as TextMetrics },
    beginPath() { cur = [] },
    moveTo(x: number, y: number) { cur.push({ x, y }) },
    lineTo(x: number, y: number) { cur.push({ x, y }) },
    fill() { if (cur.length) polys.push([...cur]) },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, polys }
}

const tileW = 22, tileH = 11
const toScreen = (col: number, row: number): Pt => ({ x: 400 + (col - row) * tileW, y: 300 + (col + row) * tileH })
const flatGround = (): number => 0
const blockH = tileW * 0.9
const roofRise = ROOF_ROWS * blockH

// The iso wall-block count = the facade BODY rows (mirrors facadeToFootprint / stampBuildingCells).
const floorsOf = (b: GridBuilding): number =>
  Math.max(1, b.cells.filter(r => r.some(k => k === 'wall' || k === 'window' || k === 'door')).length)

// The topmost wall/eave point of the footprint box (min screen-y outer diamond corner, lifted by the wall
// height) — i.e. where the OLD flat roof lid sat (roofRise = 0). The roof must reach ROOF_ROWS above this.
function eaveTopY(b: GridBuilding): number {
  const rect = buildingRect(b)
  const c0 = rect.col, c1 = rect.col + rect.w - 1, r0 = rect.row, r1 = rect.row + rect.h - 1
  const corners = [
    { x: toScreen(c0, r1).x - tileW, y: toScreen(c0, r1).y },        // fbl
    { x: toScreen(c1, r1).x, y: toScreen(c1, r1).y + tileH },        // fbr
    { x: toScreen(c0, r0).x, y: toScreen(c0, r0).y - tileH },        // bbl (back → topmost)
    { x: toScreen(c1, r0).x + tileW, y: toScreen(c1, r0).y },        // bbr
  ]
  return Math.min(...corners.map(c => c.y)) - floorsOf(b) * blockH
}

function topmostDrawnY(b: GridBuilding): number {
  const { ctx, polys } = recordingCtx()
  drawIsoBuildingTiles(ctx, b, toScreen, flatGround, 24, tileW, tileH, EMOJI_STYLE, 1)
  return Math.min(...polys.flat().map(p => p.y))
}

describe('iso roof HEIGHT — both roof types rise ROOF_ROWS above the walls (matches 2D)', () => {
  test('a BOX roof (store) is extruded EXACTLY ROOF_ROWS tall — not a height-0 flat lid at the eaves', () => {
    // The core fix. The box's top diamond sits directly above its eave corners, so the screen rise is the
    // exact extrusion: ROOF_ROWS * blockH. This is the "right now is flat" bug — a box roof now has height.
    const b = makeBuilding('store', 'south', 8, 8, 2) // seed 2 → box roof
    expect(b.cells[0].every(c => c === 'roof')).toBe(true) // sanity: this store is box (full roof row)
    expect(eaveTopY(b) - topmostDrawnY(b)).toBeCloseTo(roofRise, 3) // top sits ROOF_ROWS above the eave
  })

  test('a PEAKED roof (house) also has real height above the walls (not a flat lid)', () => {
    // The peaked gable rises `roofRise` (= ROOF_ROWS * blockH) above the eaves in WORLD space (upRoof =
    // liftEave + roofRise, unchanged). Its topmost SCREEN point is the back ridge, diagonally offset from
    // the wall corner, so the screen delta is a fraction of roofRise — but it must clearly clear the walls
    // (a flat lid would sit AT the eave → delta ~0). Guards the "roof has no height" regression for peaked.
    const b = makeBuilding('house', 'south', 8, 8)
    expect(b.cells[0].some(c => c === 'empty')).toBe(true) // sanity: peaked (narrowed apex → empty corners)
    expect(eaveTopY(b) - topmostDrawnY(b)).toBeGreaterThan(roofRise * 0.5)
  })
})

describe('store/hospital seeded peaked-vs-box — deterministic, and 2D == iso choice', () => {
  test('the same seed decides peaked-vs-box; different seeds give a MIX (deterministic)', () => {
    for (const type of ['store', 'hospital'] as const) {
      const peaked = composeBuilding({ type, seed: 0 })  // seed 0 → peaked
      const box = composeBuilding({ type, seed: 2 })     // seed 2 → box
      expect(peaked.cells[0].some(c => c === 'empty')).toBe(true)  // peaked → narrowed apex
      expect(box.cells[0].every(c => c === 'roof')).toBe(true)     // box → full roof row
      // Deterministic: recomposing the same (type, seed) yields the same roof shape.
      expect(composeBuilding({ type, seed: 0 }).cells[0]).toEqual(peaked.cells[0])
    }
  })

  test('NO seed defaults store/hospital to a BOX roof (back-compat)', () => {
    for (const type of ['store', 'hospital'] as const) {
      expect(composeBuilding({ type }).cells[0].every(c => c === 'roof')).toBe(true)
    }
  })

  test('2D and iso agree on the roof type because both read it from the composed cells', () => {
    // The composed `cells` carry the choice (empty corners ⇒ peaked). draw2DBuilding + drawIsoBuildingTiles
    // both derive `peaked` from cells[0], so a given building can never render peaked in one view + box in
    // the other. Assert the single source: a seeded-peaked store has empty roof corners; a box one doesn't.
    const peakedStore = makeBuilding('store', 'south', 8, 8, 0)
    const boxStore = makeBuilding('store', 'south', 8, 8, 2)
    expect(peakedStore.cells[0].some(c => c === 'empty')).toBe(true)
    expect(boxStore.cells[0].some(c => c === 'empty')).toBe(false)
  })
})
