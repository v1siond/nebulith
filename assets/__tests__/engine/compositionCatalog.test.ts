/**
 * The Tile-composition PALETTE catalog + the tool RENAME. The editor's old "Building" tool listed a hardcoded
 * handful of buildings; it is now "Tile composition" and must list EVERY composition the backend serves — the
 * same set the world randomizer stamps (buildings AND trees/bushes/fountains/wells/lamp posts).
 *
 * Grouping is DATA-DRIVEN: a composition's group is the backend `category` it is SERVED with (like a tile),
 * NOT a frontend name-regex / door-detection heuristic. These tests drive buildCompositionPalette against the
 * DB-equivalent seed tileset (nothing dropped, non-buildings present, sensibly bucketed) AND against synthetic
 * tilesets that PROVE the group tracks the served category and nothing else (positive + negative).
 */
import { styleCatalog } from '@/engine/tileset/styleTiles'
import '@/__tests__/helpers/installTilesetSeed' // fills styleCatalog('ascii') with the DB-equivalent compositions (now carrying category)
import type { Composition, Tileset } from '@/engine/tileset/tileset'
import {
  buildCompositionPalette,
  compositionLabel,
  COMPOSITION_CATEGORIES,
  COMPOSITION_CATEGORY_LABELS,
} from '@/engine/compositionCatalog'
import { RAIL_MODES } from '@/components/game/editorChrome'

const allKinds = () => Object.keys(styleCatalog('ascii').compositions ?? {})
const flatKinds = () => buildCompositionPalette(styleCatalog('ascii')).flatMap(s => s.items.map(i => i.kind))
const comp = (kind: string) => styleCatalog('ascii').compositions![kind]

// ── synthetic tilesets (prove the group comes from the served category, nothing else) ──────────────
const synth = (compositions: Record<string, Composition>): Tileset => ({
  id: 'x', name: 'x', tiles: {}, palettes: {}, terrain: {}, compositions,
})
const doorCell = { dx: 0, dy: 0, level: 0, label: 'door', walkable: true }
const leafCell = { dx: 0, dy: 0, level: 0, label: 'leaf_center', walkable: false }
const groupOf = (tileset: Tileset, kind: string) =>
  buildCompositionPalette(tileset).find(s => s.items.some(i => i.kind === kind))?.category

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

  test('compositions are bucketed by their SERVED backend category (buildings / nature / props)', () => {
    expect(groupOf(styleCatalog('ascii'), 'house_4')).toBe('buildings')
    expect(groupOf(styleCatalog('ascii'), 'store_5')).toBe('buildings')
    expect(groupOf(styleCatalog('ascii'), 'tree_tall')).toBe('nature')
    expect(groupOf(styleCatalog('ascii'), 'bush')).toBe('nature')
    expect(groupOf(styleCatalog('ascii'), 'fountain')).toBe('props')
    expect(groupOf(styleCatalog('ascii'), 'well')).toBe('props')
    expect(groupOf(styleCatalog('ascii'), 'lamp_post')).toBe('props')
    // the served category is exactly what the item carries — no derivation in between
    const items = buildCompositionPalette(styleCatalog('ascii')).flatMap(s => s.items)
    for (const it of items) expect(it.category).toBe(comp(it.kind).category)
  })

  test('groups are in the canonical order (subset of the tile category order), each non-empty', () => {
    const groups = buildCompositionPalette(styleCatalog('ascii')).map(s => s.category)
    // the palette groups are a prefix-subset of the canonical order (empty groups dropped, order preserved)
    expect(groups).toEqual(COMPOSITION_CATEGORIES.filter(c => groups.includes(c)))
    expect(groups).toContain('buildings')
    expect(groups).toContain('nature')
    expect(groups).toContain('props')
    // each section carries the prettier header for its bucket
    for (const s of buildCompositionPalette(styleCatalog('ascii'))) expect(s.label).toBe(COMPOSITION_CATEGORY_LABELS[s.category])
  })

  test('items carry a readable label + their footprint size (so the palette shows "how many cells")', () => {
    const items = buildCompositionPalette(styleCatalog('ascii')).flatMap(s => s.items)
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

describe('the group is the SERVED backend category — never a name-regex / door-detection heuristic', () => {
  test('a tree-NAMED composition served category:buildings lands under buildings (the name is NOT consulted)', () => {
    const t = synth({ tree_decoy: { footprint: { w: 1, h: 1 }, cells: [leafCell], category: 'buildings' } })
    expect(groupOf(t, 'tree_decoy')).toBe('buildings') // the OLD /^(tree|bush)/ regex would have said 'nature'
  })

  test('a DOOR-bearing composition served category:nature lands under nature (the door is NOT consulted)', () => {
    const t = synth({ manor: { footprint: { w: 2, h: 2 }, cells: [doorCell], category: 'nature' } })
    expect(groupOf(t, 'manor')).toBe('nature') // the OLD compositionFacesRoad door-check would have said 'Buildings'
  })

  test('each served category routes to its own bucket', () => {
    const t = synth({
      a: { footprint: { w: 1, h: 1 }, cells: [leafCell], category: 'nature' },
      b: { footprint: { w: 1, h: 1 }, cells: [leafCell], category: 'props' },
      c: { footprint: { w: 2, h: 2 }, cells: [doorCell], category: 'buildings' },
    })
    expect(groupOf(t, 'a')).toBe('nature')
    expect(groupOf(t, 'b')).toBe('props')
    expect(groupOf(t, 'c')).toBe('buildings')
  })

  test('NEGATIVE: a composition with NO category is DROPPED (browseable only when it carries a category, like a tile)', () => {
    const t = synth({ orphan: { footprint: { w: 1, h: 1 }, cells: [doorCell] } }) // a door, but no served category
    expect(flatKindsOf(t)).not.toContain('orphan')
    expect(buildCompositionPalette(t)).toEqual([]) // nothing browseable at all
  })

  test('NEGATIVE: a composition with an UNKNOWN category is DROPPED (not silently defaulted to a bucket)', () => {
    const t = synth({ weird: { footprint: { w: 1, h: 1 }, cells: [leafCell], category: 'zzz' } })
    expect(flatKindsOf(t)).not.toContain('weird')
    expect(buildCompositionPalette(t)).toEqual([])
  })
})

const flatKindsOf = (t: Tileset) => buildCompositionPalette(t).flatMap(s => s.items.map(i => i.kind))

describe('the tool-rail item is RENAMED from "Building" to a Tile-composition tool', () => {
  test('the composition mode is labelled/hinted as a Tile composition, no longer "Building"', () => {
    const item = RAIL_MODES.find(r => r.mode === 'building')!
    expect(item).toBeDefined()
    expect(item.label).not.toBe('Building')            // the old label is gone
    expect(item.hint.toLowerCase()).toContain('tile composition') // and the tool now reads as Tile composition
  })
})
