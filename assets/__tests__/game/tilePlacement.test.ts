import '@/__tests__/helpers/installTilesetSeed' // install the DB-equivalent tileset the runtime loads
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
  test('an animal (now a unit, not nature) routes to an entity', () => {
    for (const id of ['emoji:bear', 'emoji:grey-wolf', 'emoji:fox', 'emoji:cow']) {
      expect(placementFor(byId(id))).toBe('entity')
    }
  })
})

// DELIVERABLE 2 — animals are enemies/units, NOT nature (user: "we have a bunch of enemy or unit tiles on the
// nature category, like bears, wolf — animals aren't nature"). The recategorization lives in the tile DATA
// (emoji.json / the seed), so it shows up here against the REAL catalog: animals are in `units` and become
// enemies, while genuine nature (trees/rocks/plants/flowers/mushrooms) stays in `nature`.
describe('animals are units/enemies, not nature (recategorized)', () => {
  test('every animal is catalogued under units, not nature', () => {
    const natureIds = new Set(EMOJI.nature.map(t => t.id))
    const unitIds = new Set(EMOJI.units.map(t => t.id))
    for (const id of ['emoji:bear', 'emoji:grey-wolf', 'emoji:fox', 'emoji:cow', 'emoji:owl', 'emoji:cat', 'emoji:dog', 'emoji:butterfly']) {
      expect(unitIds.has(id)).toBe(true)
      expect(natureIds.has(id)).toBe(false)
    }
  })
  test('genuine nature (trees, rocks, plants, flowers, mushrooms) stays in nature', () => {
    const natureIds = new Set(EMOJI.nature.map(t => t.id))
    for (const id of ['emoji:tree', 'emoji:oak-tree', 'emoji:rock', 'emoji:boulder', 'emoji:flower', 'emoji:rose', 'emoji:mushroom', 'emoji:potted-plant']) {
      expect(natureIds.has(id)).toBe(true)
    }
  })
  test('an animal placed as a unit becomes an ENEMY (not player, not npc)', () => {
    for (const slug of ['bear', 'grey-wolf', 'fox', 'cow', 'owl', 'cat', 'dog']) {
      expect(entityKindForUnitSlug(slug)).toBe('enemy')
    }
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
