/**
 * The emoji art style, extracted into plain tileset data (EMOJI_TILESET) — "the same approach as ASCII,
 * plain JSON". EMOJI_STYLE is now DERIVED from EMOJI_TILESET. This proves the derivation is faithful
 * (every kind maps to a glyph Visual with the tileset's char+colour) and pins the values as a
 * transcription guard. Behaviour unchanged (the `[?]` tofu on unsupported Segoe glyphs is unchanged —
 * accepted; it dies later when tiles become rasterised assets).
 */
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { EMOJI_STYLE, resolveVisual, type GlyphVisual, type ImageVisual } from '@/game/artStyle'

describe('emoji tileset extraction — EMOJI_STYLE is a faithful view over EMOJI_TILESET', () => {
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

  test('the tileset is JSON-serialisable plain data (DB-seed ready)', () => {
    const round = JSON.parse(JSON.stringify(EMOJI_TILESET))
    expect(round).toEqual(EMOJI_TILESET)
    expect(round.wall).toEqual({ char: '🧱', color: '#b0603a' })
  })

  test('transcription guard — key values pinned verbatim', () => {
    expect(EMOJI_TILESET.wall).toEqual({ char: '🧱', color: '#b0603a' })
    expect(EMOJI_TILESET.roof).toEqual({ char: '🟥', color: '#c8443c' })
    expect(EMOJI_TILESET.path).toEqual({ char: '🟫', color: '#9c7b4d' })
    expect(EMOJI_TILESET.mountain).toEqual({ char: '🗻', color: '#8d8d97' })
    expect(EMOJI_TILESET.lamp).toEqual({ char: '💡', color: '#ffd24a' })
    expect(EMOJI_TILESET.player).toEqual({ char: '🧍', color: '#ffcf3a' })
    expect(EMOJI_TILESET.enemy).toEqual({ char: '👾', color: '#b45ac0' })
  })
})
