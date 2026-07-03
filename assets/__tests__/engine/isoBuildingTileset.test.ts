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
import { wallMaterialTile } from '@/engine/stageGenerator'
import { EMOJI_STYLE, ASCII_STYLE } from '@/game/artStyle'
import type { GridBuilding } from '@/engine/IsometricGrid'

// A recording canvas mock: captures every stamped glyph and counts filled polygons (the cube's faces).
function recordingCtx() {
  const glyphs: string[] = []
  let fills = 0
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', lineWidth: 1, globalAlpha: 1,
    textAlign: '' as CanvasTextAlign, textBaseline: '' as CanvasTextBaseline,
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, rect() {}, clip() {}, ellipse() {},
    transform() {}, stroke() {},
    fill() { fills++ },
    fillRect() {},
    fillText(char: string) { glyphs.push(char) },
    measureText() { return { width: 10 } as TextMetrics },
    drawImage() {},
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, glyphs, getFills: () => fills }
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

describe('drawIsoBuilding — a reskinned building is a per-cell tileset block, not a billboard', () => {
  test('Emoji style shears the building-part TILES onto the iso faces (material wall + 🚪 door + 🪟 window)', () => {
    const { ctx, glyphs } = recordingCtx()
    const b = houseBuilding()
    drawIsoBuilding(ctx, b, origin, colVec, depthVec, cellH, 1, EMOJI_STYLE)

    // The wall faces ride THIS house's material tile (sheared via tileFace); plaster is colour-only.
    const wallTile = wallMaterialTile('house', b.col)
    if (wallTile) expect(glyphs).toContain(wallTile)
    // The facade carries its own door + window tiles (a house has both).
    expect(glyphs).toContain('🚪')
    // Windows are Noto IMAGE tiles now (🪟 tofus on Segoe): the facade draws the decoded image in the
    // browser, else the non-tofu ASCII window fallback (⊞). Headless can't decode → ⊞. Still per-cell.
    expect(glyphs).toContain('⊞')
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
  test('a stone building (castle) rides 🪨 on its walls, never the brick 🧱', () => {
    const { ctx, glyphs } = recordingCtx()
    drawIsoBuilding(ctx, building('castle'), origin, colVec, depthVec, cellH, 1, EMOJI_STYLE)
    expect(glyphs).toContain('🪨')
    expect(glyphs).not.toContain('🧱')
  })

  test('a brick building (store) rides 🧱, never stone or wood', () => {
    const { ctx, glyphs } = recordingCtx()
    drawIsoBuilding(ctx, building('store'), origin, colVec, depthVec, cellH, 1, EMOJI_STYLE)
    expect(glyphs).toContain('🧱')
    expect(glyphs).not.toContain('🪨')
    expect(glyphs).not.toContain('🪵')
  })

  test('a plaster building (hospital) stamps NO wall texture (painted colour reads) but keeps its windows', () => {
    const { ctx, glyphs } = recordingCtx()
    drawIsoBuilding(ctx, building('hospital'), origin, colVec, depthVec, cellH, 1, EMOJI_STYLE)
    expect(glyphs).not.toContain('🧱')
    expect(glyphs).not.toContain('🪨')
    expect(glyphs).not.toContain('🪵')
    expect(glyphs).toContain('⊞') // windows are Noto image tiles → non-tofu ASCII (⊞) fallback headless; still a real per-cell facade
  })
})

describe('draw2DBuilding — the 2D facade is also a per-cell tileset, not a landmark sprite', () => {
  test('Emoji style stamps the per-cell facade tiles (material wall) and never the 🏠 billboard', () => {
    const { ctx, glyphs } = recordingCtx()
    const b = houseBuilding()
    draw2DBuilding(ctx, b, 400, 300, 22, 22, 1, EMOJI_STYLE)

    const wallTile = wallMaterialTile('house', b.col)
    if (wallTile) expect(glyphs).toContain(wallTile)
    expect(glyphs).not.toContain('🏠')
    expect(glyphs).not.toContain('🏡')
  })

  test('2D honours the wall MATERIAL too: a stone building (castle) uses 🪨, not 🧱', () => {
    const { ctx, glyphs } = recordingCtx()
    draw2DBuilding(ctx, building('castle'), 400, 300, 22, 22, 1, EMOJI_STYLE)
    expect(glyphs).toContain('🪨')
    expect(glyphs).not.toContain('🧱')
  })
})
