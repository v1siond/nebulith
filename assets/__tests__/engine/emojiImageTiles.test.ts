/**
 * "do A": emoji TILES that Segoe can't render (Unicode-13 glyphs like 🪟 window, 🪨 rock/cavefloor)
 * were tofu-ing to [?]. Those tiles now carry a portable Noto IMAGE asset, so resolveVisual returns
 * an ImageVisual and the already-wired drawImage path renders a picture — no tofu, cross-platform,
 * and DB-servable (the image is tile DATA). TILE emoji only; UNITS stay glyphs so genderize +
 * enemy-type variants are preserved.
 */
import fs from 'fs'
import path from 'path'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { EMOJI_STYLE, resolveVisual, type ImageVisual } from '@/game/artStyle'

// The confirmed Segoe-tofu tile kinds we convert to Noto images.
const TOFU_TILE_KINDS = ['window', 'cavefloor', 'rock'] as const
const PUBLIC_DIR = path.join(__dirname, '../../../public')

describe('emoji image tiles — Segoe-tofu glyphs render as Noto images (do A)', () => {
  test.each(TOFU_TILE_KINDS)('%s resolves to an ImageVisual (Noto png), not a raw glyph', (kind) => {
    const tile = EMOJI_TILESET[kind]
    expect(tile.image).toMatch(/\.(png|svg)$/) // the tile carries an image asset
    const v = resolveVisual(kind as never, EMOJI_STYLE)
    expect(v.kind).toBe('image')
    expect((v as ImageVisual).src).toBe(tile.image)
    expect((v as ImageVisual).color).toBe(tile.color) // backing tint kept → iso diamond/cube stays on-hue
  })

  test('every emoji tile image ref points to a bundled asset that exists on disk', () => {
    const withImages = Object.keys(EMOJI_TILESET).filter((k) => EMOJI_TILESET[k].image)
    expect(withImages.length).toBeGreaterThan(0) // guard: at least the tofu tiles were converted
    for (const kind of withImages) {
      const src = EMOJI_TILESET[kind].image!
      const file = path.join(PUBLIC_DIR, src.replace(/^\//, ''))
      expect(fs.existsSync(file)).toBe(true)
    }
  })

  test('units keep their glyphs (imaging them would flatten genderize / enemy variants)', () => {
    for (const kind of ['player', 'npc', 'enemy'] as const) {
      expect(EMOJI_TILESET[kind].image).toBeUndefined()
      expect(resolveVisual(kind as never, EMOJI_STYLE).kind).toBe('glyph')
    }
  })
})
