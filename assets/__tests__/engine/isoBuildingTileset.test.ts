/**
 * A building is a TILESET, not a sprite (user directive: "anything and everything should be used as
 * a tileset and we should work it as such"). Under a reskin (Emoji style) a building must render as
 * the geometric per-cell iso BLOCK — walls / roof / door / window each a solid iso face with the
 * style's TILE sheared onto it — NOT short-circuited to one flat whole-building landmark glyph (🏠).
 *
 * This guards the regression that produced the screenshot the user rejected: emoji buildings drawn as
 * a single upright 🏠/🏪 billboard with no z-width, off the grid cells, ignoring the iso angle. If the
 * `if (landmark) { drawBuildingLandmark(); return }` early-return ever comes back, these tests fail.
 */
import { drawIsoBuilding, type Pt } from '@/engine/render/iso'
import { draw2DBuilding } from '@/engine/render/topdown'
import { composeBuilding, type BuildingType } from '@/engine/buildingComposer'
import { wallMaterialTile, wallMaterialImage } from '@/engine/stageGenerator'
import { EMOJI_STYLE, ASCII_STYLE } from '@/game/artStyle'
import type { GridBuilding } from '@/engine/IsometricGrid'

// A recording canvas mock: captures every stamped glyph and counts filled polygons (the cube's faces).
function recordingCtx() {
  const glyphs: string[] = []
  let fills = 0
  let strokes = 0 // each window (wallWindows) draws a stroked frame — the only stroker under Emoji
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', lineWidth: 1, globalAlpha: 1,
    textAlign: '' as CanvasTextAlign, textBaseline: '' as CanvasTextBaseline,
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, rect() {}, clip() {}, ellipse() {},
    transform() {}, stroke() { strokes++ },
    fill() { fills++ },
    fillRect() {},
    fillText(char: string) { glyphs.push(char) },
    measureText() { return { width: 10 } as TextMetrics },
    drawImage() {},
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, glyphs, getFills: () => fills, getStrokes: () => strokes }
}

// A real building anchored on the grid (composeBuilding is the source-of-truth facade model). `col`
// is the material/colour seed, so a given (type, col) is deterministic.
function building(type: BuildingType, col = 5): GridBuilding {
  const c = composeBuilding({ type })
  return { col, row: 8, length: c.length, height: c.height, depth: c.depth, type: c.type, cells: c.cells }
}
const houseBuilding = (): GridBuilding => building('house')

const origin: Pt = { x: 400, y: 300 }
const colVec: Pt = { x: 22, y: 11 }   // per-column step down-right along one iso axis
const depthVec: Pt = { x: -22, y: 11 } // z-depth back along the other axis
const cellH = 24

// Windows draw on the TWO camera-visible walls only (never the two hidden far walls — see
// cameraNearWalls). The near pair is always ONE length-span wall + ONE depth-span wall, whatever the
// orientation, so per ROW the exact 🪟 count is faceWindows(length) + faceWindows(depth). Windows are now
// drawn ONE ROW PER FLOOR — a band at every facade row that carries a window — so the full count is that
// per-row pair times the number of window rows (matching the 2D elevation's floors). Asserting THIS (not a
// loose ≥) fails loudly if a third face's windows come back (#32) OR the per-floor rows regress to one.
const faceWindows = (span: number): number => Math.max(2, Math.min(4, Math.round(span / 2)))
const windowRowCount = (b: GridBuilding): number => b.cells.filter(row => row.some(k => k === 'window')).length
const expectedWindows = (b: GridBuilding): number =>
  (faceWindows(b.cells[0]?.length ?? b.length) + faceWindows(b.depth)) * windowRowCount(b)

describe('drawIsoBuilding — a reskinned building is a per-cell tileset block, not a billboard', () => {
  test('Emoji style shears the building-part TILES onto the iso faces (material wall + 🚪 door) + uniform windows', () => {
    const { ctx, glyphs } = recordingCtx()
    const b = houseBuilding()
    drawIsoBuilding(ctx, b, origin, colVec, depthVec, cellH, 1, EMOJI_STYLE)

    // The wall faces ride THIS house's material tile (sheared via tileFace); plaster is colour-only.
    const wallTile = wallMaterialTile('house', b.col)
    // brick draws its 🧱 glyph; wood/stone are Noto image tiles (no glyph headless), so only assert
    // the material glyph when the material has NO image.
    if (wallTile && !wallMaterialImage('house', b.col)) expect(glyphs).toContain(wallTile)
    // The facade still carries its own door tile.
    expect(glyphs).toContain('🚪')
    // Windows are ONE uniform, deterministic pass (wallWindows) across the TWO camera-visible faces —
    // each drawing the REAL 🪟 window TILE (headless can't decode the PNG, so the tile's 🪟 char fallback
    // is stamped). Exactly faceWindows(length)+faceWindows(depth) — the far walls get NO glass (#32).
    expect(glyphs.filter(g => g === '🪟').length).toBe(expectedWindows(b))
  })

  test('Emoji style does NOT stamp the red roof tile 🟥 on iso roof cells (roof reads its data colour, like 2D)', () => {
    const { ctx, glyphs } = recordingCtx()
    // A store is a FLAT building → it draws the facade roof rows (peaked houses skip them). Those rows
    // were stamping the emoji roof tile 🟥 (#c8443c) as a red BAND — 2D never does (topdown guards !isRoof).
    drawIsoBuilding(ctx, building('store'), origin, colVec, depthVec, cellH, 1, EMOJI_STYLE)
    expect(glyphs).not.toContain('🟥')
  })

  test('Emoji style NEVER draws the whole-building landmark sprite (no flat 🏠 billboard)', () => {
    const { ctx, glyphs } = recordingCtx()
    drawIsoBuilding(ctx, houseBuilding(), origin, colVec, depthVec, cellH, 1, EMOJI_STYLE)

    expect(glyphs).not.toContain('🏠')
    expect(glyphs).not.toContain('🏡')
  })

  test('the block has z-width — many solid iso faces are filled (walls + every roof face)', () => {
    const { ctx, getFills } = recordingCtx()
    drawIsoBuilding(ctx, houseBuilding(), origin, colVec, depthVec, cellH, 1, EMOJI_STYLE)

    // Ground shadow (1) + 3 wall faces + ≥4 roof faces ⇒ well above a flat sprite's 0. A billboard
    // filled no polygons; a real box fills one per face.
    expect(getFills()).toBeGreaterThanOrEqual(6)
  })

  test('ASCII style keeps the same box geometry but stamps NO emoji tile (passthrough intact)', () => {
    const { ctx, glyphs, getFills } = recordingCtx()
    drawIsoBuilding(ctx, houseBuilding(), origin, colVec, depthVec, cellH, 1, ASCII_STYLE)

    expect(glyphs).not.toContain('🧱')
    expect(getFills()).toBeGreaterThanOrEqual(6) // still a solid box, just ASCII-drawn
  })
})

describe('drawIsoBuilding — different wall MATERIALS, not one global brick ("not all wood")', () => {
  test('a stone building (castle) uses the STONE material (Noto image), never brick 🧱 or wood 🪵', () => {
    const { ctx, glyphs } = recordingCtx()
    drawIsoBuilding(ctx, building('castle'), origin, colVec, depthVec, cellH, 1, EMOJI_STYLE)
    // stone renders as its Noto image (headless can't decode; the 🪨 glyph tofus so it's suppressed) —
    // assert it IS stone via DATA + that no OTHER material glyph (brick/wood) leaks onto the walls.
    expect(wallMaterialImage('castle', building('castle').col)).toMatch(/emoji_u1faa8\.png$/)
    expect(glyphs).not.toContain('🧱')
    expect(glyphs).not.toContain('🟫')
  })

  test('a brick building (store) uses the BRICK material (Noto image), never stone 🪨 or wood 🟫', () => {
    const { ctx, glyphs } = recordingCtx()
    drawIsoBuilding(ctx, building('store'), origin, colVec, depthVec, cellH, 1, EMOJI_STYLE)
    // brick is a Noto image tile now (headless can't decode it; the fallback char is suppressed) — assert via DATA.
    expect(wallMaterialImage('store', building('store').col)).toMatch(/emoji_u1f9f1\.png$/)
    expect(glyphs).not.toContain('🪨')
    expect(glyphs).not.toContain('🟫')
  })

  test('a plaster building (hospital) stamps NO wall texture (painted colour reads) but keeps its windows', () => {
    const { ctx, glyphs } = recordingCtx()
    const b = building('hospital')
    drawIsoBuilding(ctx, b, origin, colVec, depthVec, cellH, 1, EMOJI_STYLE)
    expect(glyphs).not.toContain('🧱')
    expect(glyphs).not.toContain('🪨')
    expect(glyphs).not.toContain('🟫')
    // windows still come from the uniform wallWindows pass — the real 🪟 tile (char fallback headless), on
    // the two camera-visible faces only, not per-cell facade tiles.
    expect(glyphs.filter(g => g === '🪟').length).toBe(expectedWindows(b))
  })
})

describe('draw2DBuilding — the 2D facade is also a per-cell tileset, not a landmark sprite', () => {
  test('Emoji style stamps the per-cell facade tiles (material wall) and never the 🏠 billboard', () => {
    const { ctx, glyphs } = recordingCtx()
    const b = houseBuilding()
    draw2DBuilding(ctx, b, 400, 300, 22, 22, 1, EMOJI_STYLE)

    const wallTile = wallMaterialTile('house', b.col)
    // brick draws its 🧱 glyph; wood/stone are Noto image tiles (no glyph headless), so only assert
    // the material glyph when the material has NO image.
    if (wallTile && !wallMaterialImage('house', b.col)) expect(glyphs).toContain(wallTile)
    expect(glyphs).not.toContain('🏠')
    expect(glyphs).not.toContain('🏡')
  })

  test('2D honours the wall MATERIAL too: a stone castle uses the stone image, not brick 🧱 or wood 🪵', () => {
    const { ctx, glyphs } = recordingCtx()
    draw2DBuilding(ctx, building('castle'), 400, 300, 22, 22, 1, EMOJI_STYLE)
    expect(wallMaterialImage('castle', building('castle').col)).toMatch(/emoji_u1faa8\.png$/)
    expect(glyphs).not.toContain('🧱')
    expect(glyphs).not.toContain('🟫')
  })
})
