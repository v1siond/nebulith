/**
 * TILE-PLACEMENT ROUTING — the pure decision layer behind the editor's pick-first brush. These lock in
 * that an armed catalog tile is routed to the RIGHT placement primitive by its category, that a unit tile
 * becomes the right entity kind, and that a nature/building tile picks a sensible asset type + collision.
 * Exercised against the REAL catalog (tilesForStyle) so a data drift that mis-buckets a tile fails here.
 */
import { tilesForStyle, type TileDef } from '@/game/artStyle'
import {
  assetTypeForTile,
  entityKindForUnitSlug,
  placementFor,
  tileIsBlocking,
  tileSlug,
} from '@/game/editor/tilePlacement'

const EMOJI = tilesForStyle('emoji')
const byId = (id: string): TileDef => {
  const t = Object.values(EMOJI).flat().find(x => x.id === id)
  if (!t) throw new Error(`tile ${id} not in the emoji catalog`)
  return t
}

describe('tileSlug', () => {
  test('strips the style prefix', () => {
    expect(tileSlug('emoji:pine-tree')).toBe('pine-tree')
    expect(tileSlug('ascii:grass')).toBe('grass')
  })
  test('a bare id (no colon) is returned unchanged', () => {
    expect(tileSlug('grass')).toBe('grass')
  })
})

describe('placementFor — category → placement primitive', () => {
  test('terrain tiles route to ground', () => {
    for (const t of EMOJI.terrain) expect(placementFor(t)).toBe('terrain')
  })
  test('nature + buildings tiles route to a (stacked) asset', () => {
    for (const t of [...EMOJI.nature, ...EMOJI.buildings]) expect(placementFor(t)).toBe('asset')
  })
  test('a person / creature unit routes to an entity', () => {
    expect(placementFor(byId('emoji:person'))).toBe('entity')
    expect(placementFor(byId('emoji:goblin'))).toBe('entity')
    expect(placementFor(byId('emoji:player'))).toBe('entity')
  })
  test('a combat-FX / projectile unit tile falls back to an asset (never a nonsense entity)', () => {
    // These are units-category by CATEGORY_OF but are NOT placeable figures.
    expect(placementFor({ category: 'units', id: 'emoji:arrow' })).toBe('asset')
    expect(placementFor({ category: 'units', id: 'emoji:fire-slash' })).toBe('asset')
  })
})

describe('entityKindForUnitSlug', () => {
  test('the explicit player slug → player', () => {
    expect(entityKindForUnitSlug('player')).toBe('player')
  })
  test('people slugs → npc', () => {
    for (const slug of ['person', 'man', 'woman', 'old-man', 'wizard', 'guard', 'npc']) {
      expect(entityKindForUnitSlug(slug)).toBe('npc')
    }
  })
  test('creatures / unknown slugs → enemy', () => {
    for (const slug of ['goblin', 'dragon', 'zombie', 'skeleton', 'enemy', 'boss']) {
      expect(entityKindForUnitSlug(slug)).toBe('enemy')
    }
  })
})

describe('assetTypeForTile', () => {
  test('every buildings tile stamps as a "building" (blocking)', () => {
    for (const t of EMOJI.buildings) expect(assetTypeForTile(t)).toBe('building')
    expect(tileIsBlocking('building')).toBe(true)
  })
  test('nature keywords pick tree / flower / rock', () => {
    expect(assetTypeForTile(byId('emoji:pine-tree'))).toBe('tree')
    expect(assetTypeForTile(byId('emoji:oak-tree'))).toBe('tree')
    expect(assetTypeForTile(byId('emoji:rose'))).toBe('flower')
    expect(assetTypeForTile(byId('emoji:boulder'))).toBe('rock')
  })
  test('a blossom reads as a flower, not a tree (FLOWER wins the keyword race)', () => {
    expect(assetTypeForTile(byId('emoji:cherry-blossom'))).toBe('flower')
  })
  test('an unrecognised nature prop falls back to a non-blocking decoration', () => {
    expect(assetTypeForTile({ category: 'nature', id: 'emoji:seashell' })).toBe('decoration')
    expect(tileIsBlocking('decoration')).toBe(false)
  })
  test('trees / rocks block; flowers do not', () => {
    expect(tileIsBlocking('tree')).toBe(true)
    expect(tileIsBlocking('rock')).toBe(true)
    expect(tileIsBlocking('flower')).toBe(false)
  })
})
