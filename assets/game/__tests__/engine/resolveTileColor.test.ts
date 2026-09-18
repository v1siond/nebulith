/**
 * resolveTile COLOUR SOURCE, a tile's colour must come from its OWN backend `settings.colors`
 * (per zone; canopy = a per-zone variant array), NOT a shared per-zone palette blob. This is the
 * "everything is data" rule: the frontend resolves colour from the tile the backend served, never
 * from a hardcoded/shared palette. The fixture deliberately has EMPTY `palettes` to prove colour
 * no longer depends on them (the old path returned FALLBACK when palettes[zone] was missing).
 */
import { resolveTile, FALLBACK_RESOLVED, type Tileset } from '@/engine/tileset/tileset'

const TILESET: Tileset = {
  id: 'ascii',
  name: 'ASCII',
  palettes: {}, // EMPTY on purpose, colour must come from each tile's settings.colors
  terrain: {},
  compositions: {},
  tiles: {
    wall: {
      label: 'wall', char: '█', position: 'single', walkable: false, colorRole: 'building.wall',
      settings: { colors: { spring: '#ddd0a8', summer: '#c8a878' } },
    },
    leaf: {
      label: 'leaf', char: '@', position: 'single', walkable: true, colorRole: 'canopy',
      settings: { colors: { spring: ['#7cc46a', '#9ed87f', '#5fae4f'] } },
    },
    plain: {
      label: 'plain', char: '.', position: 'single', walkable: true, colorRole: '', settings: {},
    },
    // The FLAT shape the backend also serves: every emoji row, and the two ascii rows `thicket` and
    // `tall_grass`. A flat colour carries no season, so it answers for every zone.
    thicket: {
      label: 'thicket', char: '\u2619', position: 'single', walkable: false, colorRole: '',
      settings: { color: '#2f6b2a' },
    },
    // Both shapes at once: the per-zone map is the more specific answer and must win.
    both: {
      label: 'both', char: 'B', position: 'single', walkable: true, colorRole: '',
      settings: { color: '#000000', colors: { spring: '#abcdef' } },
    },
  },
}

describe("resolveTile resolves colour from each tile's own settings.colors (not a shared palette)", () => {
  test('a single-colour tile returns its per-zone colour from settings.colors', () => {
    expect(resolveTile(TILESET, 'spring', 'wall').color).toBe('#ddd0a8')
    expect(resolveTile(TILESET, 'summer', 'wall').color).toBe('#c8a878')
  })

  test('variant is ignored for a single-colour (non-array) tile', () => {
    expect(resolveTile(TILESET, 'spring', 'wall', 5).color).toBe('#ddd0a8')
  })

  test('a canopy tile picks the per-zone variant shade by index (wrapping)', () => {
    expect(resolveTile(TILESET, 'spring', 'leaf', 0).color).toBe('#7cc46a')
    expect(resolveTile(TILESET, 'spring', 'leaf', 1).color).toBe('#9ed87f')
    expect(resolveTile(TILESET, 'spring', 'leaf', 4).color).toBe('#9ed87f') // 4 % 3 = 1
  })

  test('a tile with no colour for the zone falls back (no throw/blank)', () => {
    expect(resolveTile(TILESET, 'spring', 'plain').color).toBe(FALLBACK_RESOLVED.color)
    expect(resolveTile(TILESET, 'winter', 'wall').color).toBe(FALLBACK_RESOLVED.color) // wall has no winter
  })

  // The mark and the settings ride through untouched. The field is `char`, the mark the picture was
  // baked FROM, not `glyph`; authoring `glyph` here handed resolveTile an undefined it passed straight on.
  test('the tile mark + settings still pass through', () => {
    const r = resolveTile(TILESET, 'spring', 'wall')
    expect(r.char).toBe('█')
    expect(r.settings).toBe(TILESET.tiles.wall.settings)
  })

  /**
   * THE FLAT COLOUR IS DATA, and inventing grey over it put a white flower in the forest.
   *
   * Nothing was wrong with
   * the flowers or with the blocking rule: `thicket` is authored with a flat `settings.color`, this resolver
   * read only the per-zone map, and the fallback grey then tinted the green sprig to near-white.
   */
  test("a tile whose colour is FLAT (settings.color) returns it, not the invented grey", () => {
    expect(resolveTile(TILESET, 'summer', 'thicket').color).toBe('#2f6b2a')
    expect(resolveTile(TILESET, 'summer', 'thicket').color).not.toBe(FALLBACK_RESOLVED.color)
  })

  test('a flat colour carries no season, so it answers for EVERY zone', () => {
    for (const zone of ['spring', 'summer', 'autumn', 'winter', 'desert']) {
      expect({ zone, color: resolveTile(TILESET, zone, 'thicket').color }).toEqual({ zone, color: '#2f6b2a' })
    }
  })

  test('the per-zone map WINS over a flat colour when the tile carries both', () => {
    expect(resolveTile(TILESET, 'spring', 'both').color).toBe('#abcdef')
    expect(resolveTile(TILESET, 'winter', 'both').color).toBe('#000000') // no winter in the map, flat answers
  })

  test('an unknown label returns the neutral fallback', () => {
    expect(resolveTile(TILESET, 'spring', 'nope')).toEqual(FALLBACK_RESOLVED)
  })
})
