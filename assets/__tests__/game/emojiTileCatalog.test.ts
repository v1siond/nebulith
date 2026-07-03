import { tilesForStyle, TILE_CATALOG, EMOJI_TILES, type TileDef } from '@/game/artStyle'

/**
 * The FULL emoji tileset browser (task #92): the Library must read like a real, categorized +
 * labeled tileset — all terrain, all trees/plants, all buildings, all characters. These assert
 * the coverage minimums, that every emoji tile is properly labeled with a drawable glyph, and
 * that ids stay globally unique across the WHOLE catalog (so overrides resolve unambiguously).
 */
describe('emoji tile catalog — full categorized + labeled tileset', () => {
  const grouped = tilesForStyle('emoji')

  it('surfaces a rich, categorized set: ≥12 terrain, ≥20 nature, ≥15 buildings, ≥20 units', () => {
    expect(grouped.terrain.length).toBeGreaterThanOrEqual(12)
    expect(grouped.nature.length).toBeGreaterThanOrEqual(20)
    expect(grouped.buildings.length).toBeGreaterThanOrEqual(15)
    expect(grouped.units.length).toBeGreaterThanOrEqual(20)
  })

  it('every emoji tile in the Library has a non-empty label and is drawable (glyph char OR image src)', () => {
    const emojiTiles: TileDef[] = [
      ...grouped.terrain, ...grouped.nature, ...grouped.buildings, ...grouped.units,
    ]
    expect(emojiTiles.length).toBeGreaterThan(0)
    for (const t of emojiTiles) {
      expect(t.styleId).toBe('emoji')
      expect(typeof t.label).toBe('string')
      expect(t.label.trim().length).toBeGreaterThan(0)
      // drawable = a glyph tile carries a non-empty char, OR an image tile carries a src (Noto png).
      const drawable =
        (t.visual.kind === 'glyph' && t.visual.char.length > 0) ||
        (t.visual.kind === 'image' && t.visual.src.length > 0)
      expect(drawable).toBe(true)
    }
  })

  it('every curated EMOJI_TILES id is prefixed emoji: and carries a tint colour', () => {
    for (const t of EMOJI_TILES) {
      expect(t.id.startsWith('emoji:')).toBe(true)
      expect(t.visual.kind).toBe('glyph')
      // dominant-hue tint for the iso diamond/cube fill + ASCII fallback
      expect(t.visual.kind === 'glyph' && typeof t.visual.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(t.visual.color!)).toBe(true)
    }
  })

  it('all ids are unique across the WHOLE TILE_CATALOG (no override ambiguity)', () => {
    const ids = TILE_CATALOG.map(t => t.id)
    const seen = new Map<string, number>()
    for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1)
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id)
    expect(dupes).toEqual([])
    expect(new Set(ids).size).toBe(ids.length)
  })
})
