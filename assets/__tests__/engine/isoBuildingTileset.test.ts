/**
 * A building is a TILESET, not a sprite (user directive: "anything and everything should be used as
 * a tileset and we should work it as such"). The ISO building must be the 2D FACADE + DEPTH: the same
 * per-cell material walls / windows / door / roof the 2D elevation shows, extruded into iso — NOT
 * short-circuited to one flat whole-building landmark glyph (🏠), and NOT a solid-colour billboard.
 *
 * `drawIsoBuildingTiles` is the ACTIVE iso building render (wired from render()'s obj.building branch).
 * These guard the regression the user rejected — an emoji building drawn as a single upright 🏠/🏪 with
 * no z-width, off the grid, ignoring the iso angle — AND that iso now carries the facade detail 2D has:
 * material walls, per-floor WINDOWS, a DOOR, and a peaked/flat ROOF TILE recoloured to the building's
 * own data colour (a genuine tile on every face, like 2D — no solid-colour-only roof).
 */
import { drawIsoBuildingTiles, faceWindowCount, type Pt } from '@/engine/render/iso'
import { draw2DBuilding } from '@/engine/render/topdown'
import { makeBuilding, buildingRect } from '@/engine/buildingEditor'
import { type BuildingType } from '@/engine/buildingComposer'
import { wallMaterialTile, wallMaterialImage, buildingCellColor } from '@/engine/stageGenerator'
import { EMOJI_STYLE, ASCII_STYLE } from '@/game/artStyle'
import type { GridBuilding } from '@/engine/IsometricGrid'

// A recording canvas mock: captures every stamped glyph and the colour of every filled polygon (a
// cube face / roof face). Lets us assert the per-cell tiles AND that the roof reads its data colour.
// Each stamped glyph carries the SHEAR transform active when it drew (fillIsoFaceWithTile does
// save→transform(eA/S, eB/S, origin)→…→fillText), so a test can recover a tile face's on-wall size:
// eA = (a,b)·S is the bottom edge, eB = (c,d)·S the up edge. Lets us assert the door fills a FULL cell.
interface Stamp { char: string; a: number; b: number; c: number; d: number; e: number; f: number }
function recordingCtx() {
  const glyphs: string[] = []
  const fillColors: string[] = []
  const stamps: Stamp[] = []
  let cur = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } // current shear set by transform(), read at fillText()
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', lineWidth: 1, globalAlpha: 1,
    textAlign: '' as CanvasTextAlign, textBaseline: '' as CanvasTextBaseline,
    save() {}, restore() { cur = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, rect() {}, clip() {}, ellipse() {},
    transform(a: number, b: number, c: number, d: number, e: number, f: number) { cur = { a, b, c, d, e, f } },
    stroke() {},
    fill() { fillColors.push(String(this.fillStyle)) },
    fillRect() {},
    fillText(char: string) { glyphs.push(char); stamps.push({ char, ...cur }) },
    measureText() { return { width: 10 } as TextMetrics },
    drawImage() {},
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, glyphs, fillColors, stamps, getFills: () => fillColors.length }
}

const SHEAR_BOX = 64 // fillIsoFaceWithTile's work-box side S — recover eA/eB from the recorded matrix

// A real, grid-anchored building via the canonical constructor: south-facing (front toward the camera),
// so the footprint is length × depth extruded UP by the facade's floors — exactly what render() feeds
// drawIsoBuildingTiles. `col`/`row` seed the deterministic material + colour.
function building(type: BuildingType): GridBuilding {
  return makeBuilding(type, 'south', 8, 8)
}
const houseBuilding = (): GridBuilding => building('house')

// Iso projection matching the engine (x ← col-row, y ← col+row) so the outer box corners + the two
// camera-near walls land the same way the live render does.
const tileW = 22
const tileH = 11
const toScreen = (col: number, row: number): Pt => ({ x: 400 + (col - row) * tileW, y: 300 + (col + row) * tileH })
const flatGround = (): number => 0
const draw = (b: GridBuilding, style = EMOJI_STYLE, fade = 1): ReturnType<typeof recordingCtx> => {
  const rec = recordingCtx()
  drawIsoBuildingTiles(rec.ctx, b, toScreen, flatGround, 24, tileW, tileH, style, fade)
  return rec
}

// Windows draw on the TWO camera-visible walls only (never the two hidden far walls — see
// cameraNearWalls), one BAND per floor (every facade row that carries a window), mirroring the 2D
// elevation. The near pair is always ONE length-span wall + ONE depth-span wall, so per row the exact
// 🪟 count is faceWindowCount(length) + faceWindowCount(depth); the full count is that times the number
// of window rows. Asserting THIS (not a loose ≥) fails loudly if a third face's windows come back OR the
// per-floor rows regress to one.
const windowRowCount = (b: GridBuilding): number => b.cells.filter(row => row.some(k => k === 'window')).length
const expectedWindows = (b: GridBuilding): number => {
  const rect = buildingRect(b)
  return (faceWindowCount(rect.w) + faceWindowCount(rect.h)) * windowRowCount(b)
}

describe('drawIsoBuildingTiles — the iso building is the 2D facade + depth, a per-cell tileset block', () => {
  test('Emoji: material wall tile + 🚪 door + uniform per-floor windows, never a landmark billboard', () => {
    const b = houseBuilding()
    const { glyphs } = draw(b)

    // Walls ride THIS house's material tile (sheared onto the iso faces); plaster is colour-only.
    const wallTile = wallMaterialTile('house', b.col)
    // brick draws its 🧱 glyph; wood/stone are Noto image tiles (no glyph headless), so only assert the
    // material glyph when the material has NO image.
    if (wallTile && !wallMaterialImage('house', b.col)) expect(glyphs).toContain(wallTile)
    // The low doorway carries its own door tile.
    expect(glyphs).toContain('🚪')
    // Windows: the real 🪟 tile (headless can't decode the PNG → its 🪟 char fallback), on the two
    // camera-visible faces only, one band per floor — the far walls get NO glass (#32).
    expect(glyphs.filter(g => g === '🪟').length).toBe(expectedWindows(b))
    // NEVER the whole-building landmark sprite.
    expect(glyphs).not.toContain('🏠')
    expect(glyphs).not.toContain('🏡')
  })

  // The iso door COUNT must equal the 2D facade's: ONE 🚪 face per 'door' cell in the facade's ground row
  // (house 1, cathedral 3, castle 4). Headless can't decode the door PNG, so each full-cell door face falls
  // back to exactly one 🚪 glyph — count them to get the rendered door-face count.
  const facadeDoorCount = (b: GridBuilding): number => (b.cells[b.cells.length - 1] ?? []).filter(k => k === 'door').length
  const isoDoorFaces = (b: GridBuilding): number => draw(b).glyphs.filter(g => g === '🚪').length

  test('the iso door COUNT equals the 2D facade door count — for EVERY facing (always visible, never a cube)', () => {
    // A house carries ONE facade door, a cathedral THREE, a castle FOUR — the same run the 2D elevation draws.
    // The iso must render exactly that many door FACES, and keep the count through every rotation: a south/east
    // building shows the run on its real (camera-near) entrance; a north/west building — whose entrance faces a
    // HIDDEN far wall — has the whole run MIRRORED onto a camera-near wall, so a door is ALWAYS visible (the
    // reported #24 bug: a north/west house used to show NO door at all).
    for (const [type, expected] of [['house', 1], ['cathedral', 3], ['castle', 4]] as [BuildingType, number][]) {
      expect(facadeDoorCount(makeBuilding(type, 'south', 8, 8))).toBe(expected) // sanity: the facade truly carries N doors
      for (const facing of ['south', 'east', 'north', 'west'] as const) {
        expect(isoDoorFaces(makeBuilding(type, facing, 8, 8))).toBe(expected)
      }
    }
  })

  test('each door fills a FULL wall cell — the whole face width, one block tall (not a narrow 62% doorway)', () => {
    // Recover the door face's on-wall size from its shear: eA (bottom edge) must equal the cell face's WHOLE
    // bottom edge (tileW, tileH) — width factor 1.0, not the old centred ~62% — and eB (up edge) must be a
    // single block straight up (0, -blockH) with blockH = tileW * 0.9, not the old ≤2-block doorway.
    const south = makeBuilding('house', 'south', 8, 8)
    const door = draw(south).stamps.filter(s => s.char === '🚪')
    expect(door).toHaveLength(1)
    const d0 = door[0]
    expect(d0.a * SHEAR_BOX).toBeCloseTo(tileW, 5) // full face width along the wall axis
    expect(d0.b * SHEAR_BOX).toBeCloseTo(tileH, 5)
    expect(d0.c * SHEAR_BOX).toBeCloseTo(0, 5) // up edge is vertical…
    expect(d0.d * SHEAR_BOX).toBeCloseTo(-tileW * 0.9, 5) // …exactly ONE block tall
  })

  test('Emoji: a peaked HOUSE roof is a real roof TILE recoloured to its DATA colour (like 2D)', () => {
    const b = houseBuilding()
    const { glyphs, fillColors } = draw(b)
    const roofC = buildingCellColor('house', 'roof', b.col)
    // The roof is a genuine TILE now (sheared onto the gable faces) — not skipped, not a colour-only face.
    // Headless can't recolour it, so the 🟥 tile falls back to a plain stamp; the LIVE render tints it to roofC.
    expect(glyphs).toContain('🟥')
    // …and the varied per-building roof colour still drives every face fill under the tile (never monotone red).
    expect(fillColors).toContain(roofC)
  })

  test('Emoji: a FLAT store roof (no peak) is a real roof TILE in its data colour', () => {
    const b = building('store')
    const { glyphs, fillColors } = draw(b)
    expect(glyphs).toContain('🟥') // the flat roof plane is a tile too, sheared onto the diamond top
    expect(fillColors).toContain(buildingCellColor('store', 'roof', b.col)) // …over a roofC base fill (varied colour reads)
  })

  test('the block has z-width — many solid iso faces are filled (walls + roof), not a flat sprite', () => {
    // A billboard filled 0 polygons; a real box fills one per face (each wall block × floors + the roof).
    expect(draw(houseBuilding()).getFills()).toBeGreaterThanOrEqual(6)
  })

  test('a STORE badge floats over the roof (re-added), a house carries none', () => {
    expect(draw(building('store')).glyphs).toContain('STORE')
    expect(draw(houseBuilding()).glyphs).not.toContain('STORE')
  })

  test('ASCII: same box geometry + ⊞ windows, but stamps NO emoji tile (passthrough intact)', () => {
    const { glyphs, getFills } = draw(houseBuilding(), ASCII_STYLE)
    expect(glyphs).not.toContain('🧱')
    expect(glyphs).not.toContain('🪟')
    expect(glyphs).toContain('⊞') // windows still render, as the ASCII ⊞ glyph
    expect(getFills()).toBeGreaterThanOrEqual(6) // still a solid box, just ASCII-drawn
  })
})

describe('drawIsoBuildingTiles — different wall MATERIALS, not one global brick ("not all wood")', () => {
  test('a stone building (castle) uses the STONE material (Noto image), never brick 🧱 or wood 🟫', () => {
    const b = building('castle')
    const { glyphs } = draw(b)
    // stone renders as its Noto image (headless can't decode; the 🪨 glyph tofus so it's suppressed) —
    // assert it IS stone via DATA + that no OTHER material glyph (brick/wood) leaks onto the walls.
    expect(wallMaterialImage('castle', b.col)).toMatch(/emoji_u1faa8\.png$/)
    expect(glyphs).not.toContain('🧱')
    expect(glyphs).not.toContain('🟫')
  })

  test('a brick building (store) uses the BRICK material (Noto image), never stone 🪨 or wood 🟫', () => {
    const b = building('store')
    const { glyphs } = draw(b)
    expect(wallMaterialImage('store', b.col)).toMatch(/emoji_u1f9f1\.png$/)
    expect(glyphs).not.toContain('🪨')
    expect(glyphs).not.toContain('🟫')
  })

  test('a plaster building (hospital) stamps NO wall texture (painted colour reads) but keeps its windows', () => {
    const b = building('hospital')
    const { glyphs } = draw(b)
    expect(glyphs).not.toContain('🧱')
    expect(glyphs).not.toContain('🪨')
    expect(glyphs).not.toContain('🟫')
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
    const b = building('castle')
    draw2DBuilding(ctx, b, 400, 300, 22, 22, 1, EMOJI_STYLE)
    expect(wallMaterialImage('castle', b.col)).toMatch(/emoji_u1faa8\.png$/)
    expect(glyphs).not.toContain('🧱')
    expect(glyphs).not.toContain('🟫')
  })

  test('the 2D ROOF is a TILE too now (recoloured to the roof colour), not a colour-only fill', () => {
    const { ctx, glyphs } = recordingCtx()
    const b = houseBuilding()
    draw2DBuilding(ctx, b, 400, 300, 22, 22, 1, EMOJI_STYLE)
    // The roof cell stamps the roof tile — headless can't recolour it, so 🟥 falls back to a plain stamp;
    // the LIVE render tints it to buildingCellColor('house','roof'). The point: the roof is no longer skipped.
    expect(glyphs).toContain('🟥')
  })

  test('2D ASCII roof stays passthrough — no 🟥 emoji tile stamped', () => {
    const { ctx, glyphs } = recordingCtx()
    const b = houseBuilding()
    draw2DBuilding(ctx, b, 400, 300, 22, 22, 1, ASCII_STYLE)
    expect(glyphs).not.toContain('🟥') // ASCII draws its own /\ roof glyph, never the emoji tile
  })
})
