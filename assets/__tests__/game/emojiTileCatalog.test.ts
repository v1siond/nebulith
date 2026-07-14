import '@/__tests__/helpers/installTilesetSeed' // install the DB-equivalent tileset the runtime loads
import { tilesForStyle, type TileDef } from '@/game/artStyle'

/**
 * The FULL emoji tileset browser: the Library must read like a real, categorized + labeled tileset — all
 * terrain, all trees/plants, all buildings, all characters — read LIVE from the LOADED (DB) tileset, not a
 * hardcoded frontend catalog. These assert the coverage minimums, that every browseable tile is properly
 * labeled + drawable, and that ids stay globally unique (so per-element overrides resolve unambiguously).
 */
describe('emoji tile catalog — full categorized + labeled tileset (from the loaded tileset)', () => {
  const grouped = tilesForStyle('emoji')
  const all: TileDef[] = [...grouped.terrain, ...grouped.nature, ...grouped.buildings, ...grouped.units]

  it('surfaces a rich, categorized set: ≥12 terrain, ≥20 nature, ≥15 buildings, ≥20 units', () => {
    expect(grouped.terrain.length).toBeGreaterThanOrEqual(12)
    expect(grouped.nature.length).toBeGreaterThanOrEqual(20)
    expect(grouped.buildings.length).toBeGreaterThanOrEqual(15)
    expect(grouped.units.length).toBeGreaterThanOrEqual(20)
  })

  it('every emoji tile in the Library has a non-empty label and is drawable (glyph char OR image src)', () => {
    expect(all.length).toBeGreaterThan(0)
    for (const t of all) {
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

  it('every browseable emoji tile id is prefixed emoji: and carries a tint colour', () => {
    for (const t of all) {
      expect(t.id.startsWith('emoji:')).toBe(true)
      // A unit whose glyph was baked to a Noto PNG is an IMAGE tile (goblin/man/…); the rest stay glyphs.
      // Either way it carries the dominant-hue tint for the iso diamond/cube fill + the ASCII fallback.
      expect(['glyph', 'image']).toContain(t.visual.kind)
      const color = t.visual.kind === 'glyph' || t.visual.kind === 'image' ? t.visual.color : undefined
      expect(typeof color === 'string' && /^#[0-9a-f]{3,8}$/i.test(color)).toBe(true)
    }
  })

  it('all ids are unique across BOTH styles (no override ambiguity)', () => {
    const ids = [
      ...Object.values(tilesForStyle('emoji')).flat(),
      ...Object.values(tilesForStyle('ascii')).flat(),
    ].map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
