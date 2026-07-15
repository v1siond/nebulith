/**
 * Data-driven decor + canopy: the generator reads BOTH from the loaded backend tileset, not a
 * frontend colour table. `canopyCount` = how many canopy shades a zone's leaf tile carries;
 * `decorTilesForZone` / `pickGroundDecor` select a ground-decor TILE for a zone from the tiles
 * that opt into it (settings.colors[zone]). These replace the deleted cellTileset TREE_CANOPY_SHADES
 * + GROUND_DECOR. The fixture is the captured /api/tilesets response (real DB tiles).
 */
import { canopyCount, decorTilesForZone, pickGroundDecor, type Tileset } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import type { ZoneId } from '@/engine/zones'

const ZONES: ZoneId[] = ['spring', 'summer', 'autumn', 'winter', 'desert', 'beach', 'lava']
const EMPTY: Tileset = { id: 'x', name: 'x', tiles: {}, palettes: {}, terrain: {} }
const isHex = (c: string): boolean => /^#[0-9a-fA-F]{3,8}$/.test(c)

describe('canopyCount — reads the leaf_center canopy-shade count from the loaded tileset', () => {
  useSeedTileset()

  it('matches the leaf_center tile settings.colors[zone] array length for every zone', () => {
    for (const zone of ZONES) {
      const shades = (ASCII_TILESET.tiles['leaf_center'].settings as { colors: Record<string, string[]> }).colors[zone]
      expect(Array.isArray(shades)).toBe(true)
      expect(canopyCount(ASCII_TILESET, zone)).toBe(shades.length)
    }
  })

  it('falls back to >= 1 when the tileset is empty (unloaded) — tree gen never divides by zero', () => {
    expect(canopyCount(EMPTY, 'summer')).toBe(1)
  })

  it('falls back to 1 for a zone with no canopy colour', () => {
    expect(canopyCount(ASCII_TILESET, 'not_a_zone')).toBe(1)
  })
})

describe('decorTilesForZone — the decor tiles that opt into a zone via settings.colors', () => {
  useSeedTileset()

  // The per-zone counts ported from the old GROUND_DECOR (spring 2, summer 1, rest 2).
  const EXPECTED_COUNT: Record<ZoneId, number> = {
    spring: 2, summer: 1, autumn: 2, winter: 2, desert: 2, beach: 2, lava: 2,
  }

  it('returns only category==="decor" tiles whose colours carry the zone', () => {
    for (const zone of ZONES) {
      const decors = decorTilesForZone(ASCII_TILESET, zone)
      expect(decors.length).toBe(EXPECTED_COUNT[zone])
      for (const t of decors) {
        expect(t.category).toBe('decor')
        const colors = (t.settings as { colors: Record<string, string> }).colors
        expect(colors[zone]).toBeDefined()
      }
    }
  })

  it('is sorted by label so selection is deterministic regardless of backend row order', () => {
    const labels = decorTilesForZone(ASCII_TILESET, 'lava').map(t => t.label)
    expect(labels).toEqual([...labels].sort())
  })

  it('returns [] for an empty tileset', () => {
    expect(decorTilesForZone(EMPTY, 'summer')).toEqual([])
  })
})

describe('pickGroundDecor — deterministic per-cell selection resolved to glyph + zone colour', () => {
  useSeedTileset()

  it('returns null when the zone has no decor (empty tileset)', () => {
    expect(pickGroundDecor(EMPTY, 'summer', 3, 4)).toBeNull()
  })

  it('is deterministic — the same cell always resolves to the same decor', () => {
    const a = pickGroundDecor(ASCII_TILESET, 'autumn', 5, 9)
    const b = pickGroundDecor(ASCII_TILESET, 'autumn', 5, 9)
    expect(a).toEqual(b)
  })

  it('resolves to that decor tile’s own zone colour + glyph (a valid hex, not the neutral fallback)', () => {
    const zoneColors = decorTilesForZone(ASCII_TILESET, 'spring').map(
      t => (t.settings as { colors: Record<string, string> }).colors.spring,
    )
    const glyphs = decorTilesForZone(ASCII_TILESET, 'spring').map(t => t.glyph)
    const r = pickGroundDecor(ASCII_TILESET, 'spring', 2, 3)!
    expect(r).not.toBeNull()
    expect(isHex(r.color)).toBe(true)
    expect(zoneColors).toContain(r.color)
    expect(glyphs).toContain(r.char)
  })

  it('covers every decor variant of a multi-decor zone across the grid', () => {
    const seen = new Set<string>()
    for (let col = 0; col < 12; col++) for (let row = 0; row < 12; row++) {
      const r = pickGroundDecor(ASCII_TILESET, 'spring', col, row)
      if (r) seen.add(r.char)
    }
    expect(seen.size).toBe(2) // spring has two decor glyphs
  })
})
