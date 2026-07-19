/**
 * The Tile-composition PALETTE catalog + the tool RENAME. The editor's old "Building" tool listed a hardcoded
 * handful of buildings; it is now "Tile composition" and must list EVERY composition the backend serves — the
 * same set the world randomizer stamps (buildings AND trees/bushes/fountains/wells/lamp posts). These tests
 * drive buildCompositionPalette against the DB-equivalent seed tileset and assert nothing is dropped and the
 * non-building compositions are present + grouped sensibly, plus that the tool-rail label was renamed.
 */
import '@/__tests__/helpers/installTilesetSeed' // fills ASCII_TILESET with the DB-equivalent compositions
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { buildCompositionPalette, compositionGroup, compositionLabel, COMPOSITION_GROUP_ORDER } from '@/engine/compositionCatalog'
import { RAIL_MODES } from '@/components/game/editorChrome'

const allKinds = () => Object.keys(ASCII_TILESET.compositions ?? {})
const flatKinds = () => buildCompositionPalette(ASCII_TILESET).flatMap(s => s.items.map(i => i.kind))
const comp = (kind: string) => ASCII_TILESET.compositions![kind]

describe('buildCompositionPalette lists EVERY backend composition, not just buildings', () => {
  test('every composition the tileset serves appears exactly once in the palette', () => {
    const listed = flatKinds().sort()
    const served = allKinds().sort()
    expect(served.length).toBeGreaterThan(10)             // the seed has the full set, not a stub
    expect(listed).toEqual(served)                        // none dropped, none invented, no duplicates
  })

  test('the NON-building compositions (props + nature) are listed — the whole point of the rename', () => {
    const listed = new Set(flatKinds())
    // props the randomizer stamps but the old building-only card omitted:
    expect(listed.has('fountain')).toBe(true)
    expect(listed.has('well')).toBe(true)
    expect(listed.has('lamp_post')).toBe(true)
    // tree/bush variants the randomizer scatters:
    expect(listed.has('tree')).toBe(true)
    expect(listed.has('tree_tall')).toBe(true)
    expect(listed.has('bush')).toBe(true)
    // and the buildings are still there:
    expect(listed.has('house_4')).toBe(true)
    expect(listed.has('store_5')).toBe(true)
    expect(listed.has('castle_12')).toBe(true)
  })

  test('compositions are bucketed sensibly: door-bearing → Buildings, tree/bush → Nature, the rest → Props', () => {
    expect(compositionGroup('house_4', comp('house_4'))).toBe('Buildings')
    expect(compositionGroup('store_5', comp('store_5'))).toBe('Buildings')
    expect(compositionGroup('tree_tall', comp('tree_tall'))).toBe('Nature')
    expect(compositionGroup('bush', comp('bush'))).toBe('Nature')
    expect(compositionGroup('fountain', comp('fountain'))).toBe('Props')
    expect(compositionGroup('well', comp('well'))).toBe('Props')
    expect(compositionGroup('lamp_post', comp('lamp_post'))).toBe('Props')
  })

  test('groups are in a stable display order (Buildings → Nature → Props), each non-empty', () => {
    const groups = buildCompositionPalette(ASCII_TILESET).map(s => s.group)
    // the palette groups are a prefix of the canonical order (empty groups dropped, order preserved)
    expect(groups).toEqual(COMPOSITION_GROUP_ORDER.filter(g => groups.includes(g)))
    expect(groups).toContain('Buildings')
    expect(groups).toContain('Nature')
    expect(groups).toContain('Props')
  })

  test('items carry a readable label + their footprint size (so the palette shows "how many cells")', () => {
    const items = buildCompositionPalette(ASCII_TILESET).flatMap(s => s.items)
    const byKind = new Map(items.map(i => [i.kind, i]))
    // an authored title wins; else the kind is humanised
    expect(compositionLabel('store_5', comp('store_5'))).toBe('Store')       // title
    expect(compositionLabel('house_4', comp('house_4'))).toBe('House 4')     // humanised, size kept
    expect(compositionLabel('lamp_post', comp('lamp_post'))).toBe('Lamp post')
    // footprint rides along for the button's size badge
    expect(byKind.get('fountain')!.footprint).toEqual(comp('fountain').footprint)
    expect(byKind.get('house_4')!.footprint).toEqual(comp('house_4').footprint)
  })

  test('an empty tileset yields an empty palette (no crash before the backend loads)', () => {
    expect(buildCompositionPalette({ id: 'x', name: 'x', tiles: {}, palettes: {}, terrain: {}, compositions: {} })).toEqual([])
    expect(buildCompositionPalette({ id: 'x', name: 'x', tiles: {}, palettes: {}, terrain: {} })).toEqual([])
  })
})

describe('the tool-rail item is RENAMED from "Building" to a Tile-composition tool', () => {
  test('the composition mode is labelled/hinted as a Tile composition, no longer "Building"', () => {
    const item = RAIL_MODES.find(r => r.mode === 'building')!
    expect(item).toBeDefined()
    expect(item.label).not.toBe('Building')            // the old label is gone
    expect(item.hint.toLowerCase()).toContain('tile composition') // and the tool now reads as Tile composition
  })
})
