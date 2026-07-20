/**
 * EMOJI_STYLE is DERIVED from the loaded emoji tileset (emojiStyleMap / rebuildEmojiStyle) — this proves
 * the derivation is faithful: every kind maps to a Visual matching its tile (an image tile → ImageVisual,
 * a glyph-only tile → GlyphVisual), and the style's keys track the tileset's exactly.
 *
 * The frontend ships NO bundled tile data, so we install the DB-equivalent fixture (the captured
 * `/api/tilesets` response) and assert the derivation over THAT — the same data the runtime loads from the
 * backend. There is no verbatim value pin any more: the tile values live in the backend, not the frontend.
 */
import '@/__tests__/helpers/installTilesetSeed' // fill the (empty) emoji holder with the DB-equivalent fixture
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { EMOJI_STYLE, resolveVisual, type GlyphVisual, type ImageVisual } from '@/game/artStyle'

describe('emoji tileset extraction — EMOJI_STYLE is a faithful view over the loaded tileset', () => {
  test('the loaded tileset is non-empty (the fixture installed)', () => {
    expect(Object.keys(EMOJI_TILESET).length).toBeGreaterThan(0)
  })

  test('every kind becomes a Visual matching its tile — image tiles → ImageVisual, else GlyphVisual', () => {
    for (const kind of Object.keys(EMOJI_TILESET)) {
      const tile = EMOJI_TILESET[kind]
      const expected = tile.image
        ? { kind: 'image', src: tile.image, color: tile.color, char: tile.char } // image tiles keep the source glyph as label/fallback
        : { kind: 'glyph', char: tile.char, color: tile.color }
      expect(EMOJI_STYLE.map[kind as keyof typeof EMOJI_STYLE.map]).toEqual(expected)
    }
  })

  test('resolveVisual over the derived style returns each kind’s emoji tile', () => {
    for (const kind of Object.keys(EMOJI_TILESET)) {
      const tile = EMOJI_TILESET[kind]
      const v = resolveVisual(kind as never, EMOJI_STYLE)
      if (tile.image) {
        expect(v.kind).toBe('image')
        expect((v as ImageVisual).src).toBe(tile.image)
      } else {
        expect(v.kind).toBe('glyph')
        expect((v as GlyphVisual).char).toBe(tile.char)
      }
      expect((v as GlyphVisual | ImageVisual).color).toBe(tile.color) // both carry the backing tint
    }
  })

  test('EMOJI_STYLE.map has exactly the tileset’s kinds (no drift either way)', () => {
    expect(Object.keys(EMOJI_STYLE.map).sort()).toEqual(Object.keys(EMOJI_TILESET).sort())
  })
})
