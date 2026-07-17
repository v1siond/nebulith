/**
 * REAL-CANVAS ground-decor tests — the standard (jsdom can't read pixels).
 *
 * MODEL (nebulith MAP-MODEL §4/§8, TILE-BACKEND-MIGRATION §5/§7): every tile is a baked backend IMAGE
 * resolved by its LABEL; there are NO glyphs, no glyph fallbacks. Ground decor (flowers/clover/pebbles) is
 * a tile like any other — so it must draw its OWN baked decor tile image (resolved by label for the active
 * style, colour-composited via `tintedImage`), NOT a fillText dingbat. These tests render the production
 * draw path to a real rasteriser (@napi-rs/canvas) and read the PIXELS: a baked decor tile stand-in painted
 * on the ground comes back as an IMAGE (a filled diamond), recoloured to the decor colour — never a glyph.
 *
 * Routing: makeGroundDecor carries the decor tile's LABEL, and the render (groundDecorImage → labelTileImage)
 * resolves that label to the baked image per style. Both proven here, per style (emoji AND ascii).
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { drawIsoAssetAscii } from '@/engine/render/iso'
import { groundDecorImage } from '@/engine/render/shared'
import { makeGroundDecor } from '@/engine/stageGenerator'
import { pickGroundDecor } from '@/engine/tileset/tileset'
import { EMOJI_STYLE, ASCII_STYLE } from '@/game/artStyle'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { labelTileImage } from '@/engine/render/shared'
import type { GridAsset } from '@/engine/IsometricGrid'

let H: RealCanvasHarness

const GREEN = '#00c800'
const MAGENTA = '#ff00ff'

// A ground-decor label baked into EACH style, mirroring the real backend rows (category 'decor', a per-zone
// colour, an image_url). The generator PICKS decor by these labels; the render resolves the label → image.
const EMOJI_LABEL = '__gd_emoji_flower__'
const ASCII_LABEL = '__gd_ascii_flower__'
const EMOJI_SRC = '/tiles/emoji/__gd_flower.png'
const ASCII_SRC = '/tiles/ascii/__gd_flower.png'

// iso cell size for the draw (half-width, half-height of the ground diamond)
const TW = 30, TH = 15

const decorAsset = (label: string, color?: string): GridAsset =>
  ({ art: ['❀'], col: 3, row: 3, type: 'ground_decor', label, color } as unknown as GridAsset)

/** Render one ground-decor asset onto the iso ground and scan the pixels. */
function renderDecorIso(label: string, color: string | undefined, style: typeof EMOJI_STYLE): ReturnType<RealCanvasHarness['scan']> {
  const cv = H.makeCanvas(240, 260)
  const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
  drawIsoAssetAscii(ctx, 120, 170, decorAsset(label, color), TW, TH, 0, false, 'day', style)
  return H.scan(cv)
}

beforeAll(async () => {
  H = installRealCanvas().harness
  // Seed a decor tile in BOTH styles (as the DB serves them). Emoji bakes a coloured PNG (GREEN stand-in);
  // ascii bakes a WHITE tint-target that the decor colour recolours.
  EMOJI_TILESET[EMOJI_LABEL] = { char: '❀', color: '#7ac07a', image: EMOJI_SRC, height: 0, category: 'decor', settings: { colors: { spring: '#7ac07a' } } }
  ASCII_TILESET.tiles[ASCII_LABEL] = { label: ASCII_LABEL, glyph: '❀', position: 'single', walkable: true, colorRole: 'decor', category: 'decor', settings: { colors: { spring: '#c79bb4' } }, image: { kind: 'image', src: ASCII_SRC } }
  H.registerSolid(EMOJI_SRC, GREEN)
  H.registerSolid(ASCII_SRC, '#ffffff') // ascii tiles bake white so a colour setting can recolour them
  await H.warm([EMOJI_SRC, ASCII_SRC])
})
afterAll(() => { delete EMOJI_TILESET[EMOJI_LABEL]; delete ASCII_TILESET.tiles[ASCII_LABEL] })

describe('ground decor renders its BAKED IMAGE (not a fillText glyph) — iso, per style', () => {
  test('EMOJI: decor with no colour draws its NATIVE baked image (a filled GREEN diamond, not a small glyph)', () => {
    const s = renderDecorIso(EMOJI_LABEL, undefined, EMOJI_STYLE)
    expect(s.opaque).toBeGreaterThan(300)   // a full ground-diamond image fill — a dingbat glyph could never
    expect(s.greenish).toBeGreaterThan(300) // the GREEN baked tile itself is on the ground (image, not a glyph)
    expect(s.magentaish).toBe(0)
  })

  test('ASCII: decor draws its baked image (a filled diamond), not the dingbat glyph', () => {
    // ascii bakes white; with a decor colour it recolours (covered below). Here: no colour → a filled WHITE
    // diamond, i.e. a large opaque area no single glyph would produce.
    const s = renderDecorIso(ASCII_LABEL, undefined, ASCII_STYLE)
    expect(s.opaque).toBeGreaterThan(300)
    expect(s.meanR).toBeGreaterThan(180)     // near-white fill (the baked tile), not a thin coloured glyph
    expect(s.meanG).toBeGreaterThan(180)
    expect(s.meanB).toBeGreaterThan(180)
  })
})

describe('the decor COLOUR setting filters the decor image — iso, per style', () => {
  test('EMOJI: a GREEN decor tile set to magenta comes back MAGENTA, no green survives', () => {
    const s = renderDecorIso(EMOJI_LABEL, MAGENTA, EMOJI_STYLE)
    expect(s.opaque).toBeGreaterThan(300)
    expect(s.magentaish).toBeGreaterThan(300) // the image was recoloured toward the decor colour
    expect(s.greenish).toBe(0)                // the native green is filtered out (colour filters the IMAGE)
  })

  test('ASCII: a white decor tile set to magenta recolours the tile image to MAGENTA', () => {
    const s = renderDecorIso(ASCII_LABEL, MAGENTA, ASCII_STYLE)
    expect(s.opaque).toBeGreaterThan(300)
    expect(s.magentaish).toBeGreaterThan(300) // white → magenta (the colour filters the baked image)
  })
})

describe('routing — makeGroundDecor carries the tile LABEL, and the render resolves its baked image', () => {
  // NOTE: makeGroundDecor reads the module ASCII_TILESET; only our ascii decor label is present, so the
  // per-cell pick lands on it for the 'spring' zone (its settings.colors carries 'spring').
  test('pickGroundDecor exposes the decor tile LABEL (the render swap key)', () => {
    const picked = pickGroundDecor(ASCII_TILESET, 'spring', 4, 7)
    expect(picked).not.toBeNull()
    expect(picked!.label).toBe(ASCII_LABEL)
  })

  test('makeGroundDecor stamps the decor LABEL onto the ground_decor prop', () => {
    const prop = makeGroundDecor('spring', 4, 7)
    expect(prop).not.toBeNull()
    expect(prop!.type).toBe('ground_decor')
    expect(prop!.label).toBe(ASCII_LABEL)
  })

  test('the draw path resolves that label to the baked image, per style (ascii + emoji)', () => {
    const prop = makeGroundDecor('spring', 4, 7)!
    // ascii: the prop's own label resolves the baked ascii decor image
    const asciiAsset = decorAsset(prop.label!, prop.color)
    expect(groundDecorImage(asciiAsset, ASCII_STYLE)).toBeTruthy()
    expect(labelTileImage(prop.label!, ASCII_STYLE)).toBeTruthy()
    // emoji: the same label resolves the baked emoji decor image (our seeded emoji decor)
    const emojiAsset = decorAsset(EMOJI_LABEL, MAGENTA)
    expect(groundDecorImage(emojiAsset, EMOJI_STYLE)).toBeTruthy()
  })

  test('groundDecorImage returns nothing for a non-decor asset or a decor asset with no label (never invents a glyph)', () => {
    expect(groundDecorImage(decorAsset('', undefined), ASCII_STYLE)).toBeUndefined()
    expect(groundDecorImage(({ art: ['🌳'], col: 0, row: 0, type: 'tree', label: 'leaf_center' } as unknown as GridAsset), ASCII_STYLE)).toBeUndefined()
  })
})
