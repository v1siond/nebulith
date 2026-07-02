/**
 * The emoji art style, extracted into plain tileset data (EMOJI_TILESET) — "the same approach as ASCII,
 * plain JSON". EMOJI_STYLE is now DERIVED from EMOJI_TILESET. This proves the derivation is faithful
 * (every kind maps to a glyph Visual with the tileset's char+colour) and pins the values as a
 * transcription guard. Behaviour unchanged (the `[?]` tofu on unsupported Segoe glyphs is unchanged —
 * accepted; it dies later when tiles become rasterised assets).
 */
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { EMOJI_STYLE, resolveVisual, type GlyphVisual } from '@/game/artStyle'

describe('emoji tileset extraction — EMOJI_STYLE is a faithful view over EMOJI_TILESET', () => {
  test('every kind in the tileset becomes a glyph Visual with the tileset char + colour', () => {
    for (const kind of Object.keys(EMOJI_TILESET)) {
      const tile = EMOJI_TILESET[kind]
      expect(EMOJI_STYLE.map[kind as keyof typeof EMOJI_STYLE.map]).toEqual({ kind: 'glyph', char: tile.char, color: tile.color })
    }
  })

  test('resolveVisual over the derived style returns each kind’s emoji tile', () => {
    for (const kind of Object.keys(EMOJI_TILESET)) {
      const v = resolveVisual(kind as never, EMOJI_STYLE) as GlyphVisual
      expect(v.kind).toBe('glyph')
      expect(v.char).toBe(EMOJI_TILESET[kind].char)
      expect(v.color).toBe(EMOJI_TILESET[kind].color)
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
