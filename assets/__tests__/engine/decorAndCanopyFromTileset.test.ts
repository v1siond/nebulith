/**
 * Data-driven decor + canopy: the generator reads BOTH from the loaded backend tileset, not a
 * frontend colour table. `canopyCount` = how many canopy shades a zone's leaf tile carries;
 * `decorTilesForZone` / `pickGroundDecor` select a ground-decor TILE for a zone from the tiles
 * that opt into it (settings.colors[zone]). These replace the deleted cellTileset TREE_CANOPY_SHADES
 * + GROUND_DECOR. The fixture is the captured /api/tilesets response (real DB tiles).
 */
import { styleCatalog, styleTile } from '@/engine/tileset/styleTiles'
import { canopyCount, decorTilesForZone, pickGroundDecor, type Tileset } from '@/engine/tileset/tileset'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import type { ZoneId } from '@/engine/zones'

const ZONES: ZoneId[] = ['spring', 'summer', 'autumn', 'winter', 'desert', 'beach', 'lava']
const EMPTY: Tileset = { id: 'x', name: 'x', tiles: {}, palettes: {}, terrain: {} }
const isHex = (c: string): boolean => /^#[0-9a-fA-F]{3,8}$/.test(c)

describe('canopyCount — reads the leaf_center canopy-shade count from the loaded tileset', () => {
  useSeedTileset()

  it('matches the leaf_center tile settings.colors[zone] array length for every zone', () => {
    for (const zone of ZONES) {
      const shades = (styleTile('ascii', 'leaf_center').settings as { colors: Record<string, string[]> }).colors[zone]
      expect(Array.isArray(shades)).toBe(true)
      expect(canopyCount(styleCatalog('ascii'), zone)).toBe(shades.length)
    }
  })

  it('falls back to >= 1 when the tileset is empty (unloaded) — tree gen never divides by zero', () => {
    expect(canopyCount(EMPTY, 'summer')).toBe(1)
  })

  it('falls back to 1 for a zone with no canopy colour', () => {
    expect(canopyCount(styleCatalog('ascii'), 'not_a_zone')).toBe(1)
  })
})

describe('decorTilesForZone — the decor tiles that opt into a zone via settings.colors', () => {
  useSeedTileset()

  it('returns only category==="decor" tiles whose colours carry the zone', () => {
    // THE PROPERTY, not a count. This carried a per-zone tally copied from the old hardcoded table, so it
    // failed the moment the catalogue described its own tiles differently: two blooms moved out of `decor`
    // and into `nature`, where the other flowers live, and this said the code was broken. What the function
    // promises is that every tile it returns is decor AND carries a colour for the zone, and that a zone is
    // never left with nothing to cover its ground with.
    for (const zone of ZONES) {
      const decors = decorTilesForZone(styleCatalog('ascii'), zone)
      expect({ zone, has: decors.length > 0 }).toEqual({ zone, has: true })
      for (const t of decors) {
        expect(t.category).toBe('decor')
        const colors = (t.settings as { colors: Record<string, string> }).colors
        expect(colors[zone]).toBeDefined()
      }
    }
  })

  it('carries no BLOOM: a flower is nature, and which blooms grow somewhere is the environment to say', () => {
    for (const zone of ZONES) {
      const labels = decorTilesForZone(styleCatalog('ascii'), zone).map(t => t.label)
      expect({ zone, blooms: labels.filter(l => l.includes('flower') || l.includes('blossom')) })
        .toEqual({ zone, blooms: [] })
    }
  })

  it('is sorted by label so selection is deterministic regardless of backend row order', () => {
    const labels = decorTilesForZone(styleCatalog('ascii'), 'lava').map(t => t.label)
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
    const a = pickGroundDecor(styleCatalog('ascii'), 'autumn', 5, 9)
    const b = pickGroundDecor(styleCatalog('ascii'), 'autumn', 5, 9)
    expect(a).toEqual(b)
  })

  it('resolves to that decor tile’s own zone colour + glyph (a valid hex, not the neutral fallback)', () => {
    const zoneColors = decorTilesForZone(styleCatalog('ascii'), 'spring').map(
      t => (t.settings as { colors: Record<string, string> }).colors.spring,
    )
    const glyphs = decorTilesForZone(styleCatalog('ascii'), 'spring').map(t => t.char) // `glyph` is not a field a tile has
    const r = pickGroundDecor(styleCatalog('ascii'), 'spring', 2, 3)!
    expect(r).not.toBeNull()
    expect(isHex(r.color)).toBe(true)
    expect(zoneColors).toContain(r.color)
    expect(glyphs).toContain(r.char)
  })

  it('covers every decor variant of a multi-decor zone across the grid', () => {
    // THE ZONE COMES FROM THE DATA. This named spring and asserted "two decor glyphs", so it broke when the
    // catalogue moved spring's two blooms into `nature` where the other flowers live. What it defends is that
    // the per-cell pick REACHES every variant a zone has rather than settling on one, which is a property of
    // any zone carrying more than one.
    const zone = ZONES.find(z => decorTilesForZone(styleCatalog('ascii'), z).length > 1)
    expect({ aZoneWithSeveral: zone !== undefined }).toEqual({ aZoneWithSeveral: true })
    const variants = decorTilesForZone(styleCatalog('ascii'), zone!).length
    const seen = new Set<string>()
    for (let col = 0; col < 12; col++) for (let row = 0; row < 12; row++) {
      const r = pickGroundDecor(styleCatalog('ascii'), zone!, col, row)
      if (r) seen.add(r.char)
    }
    expect({ zone, reached: seen.size }).toEqual({ zone, reached: variants })
  })
})
