import '@/__tests__/helpers/installTilesetSeed' // install the DB-equivalent tileset the runtime loads
/**
 * TILE-PLACEMENT ROUTING — the pure decision layer behind the editor's pick-first brush. These lock in
 * that an armed catalog tile is routed to the RIGHT placement primitive by its category, that a unit tile
 * becomes the right entity kind, and that a nature/building tile picks a sensible asset type + collision.
 * Exercised against the REAL catalog (tilesForStyle) so a data drift that mis-buckets a tile fails here.
 */
import { tilesForStyle, type TileDef } from '@/game/artStyle'
import {
  entityKindForUnitTile,
  placementFor,
  tileSlug,
} from '@/game/editor/tilePlacement'

const EMOJI = tilesForStyle('emoji')
const byId = (id: string): TileDef => {
  const t = Object.values(EMOJI).flat().find(x => x.id === id)
  if (!t) throw new Error(`tile ${id} not in the emoji catalog`)
  return t
}

/**
 * A units tile as the CATALOG serves one.
 *
 * `entityKindForUnitSlug(slug)` is gone. The kind a figure places as is read from its served `unitRole`
 * now, not guessed from its name — the same move that took per-label collision out of the frontend. So the
 * test states the role, which is what the backend states, and the slug only matters for `player`.
 */
const unitTile = (slug: string, role?: string) => ({
  id: `ascii:${slug}`,
  settings: role === undefined ? {} : { unitRole: role },
})


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
  test('ground tiles (terrain / roads / floors) route to ground', () => {
    for (const t of [...EMOJI.terrain, ...EMOJI.roads, ...EMOJI.floors]) expect(placementFor(t)).toBe('terrain')
  })
  test('nature + structural pieces (walls/windows/doors/roofs) + props route to a (stacked) asset', () => {
    for (const t of [...EMOJI.nature, ...EMOJI.walls, ...EMOJI.windows, ...EMOJI.doors, ...EMOJI.roofs, ...EMOJI.props]) {
      expect(placementFor(t)).toBe('asset')
    }
  })
  // These pass the ROLE explicitly rather than reading it off the seed fixture, because the role is the
  // input under test and the fixture cannot carry it: `unitRole` is assigned by the BACKEND at seed time
  // (tile_source.ex — `put_tile_setting(…, "unitRole", role_for(…))`), while the test helper installs
  // `emoji.json` directly. Mirroring `role_for` in a frontend helper would duplicate backend logic; stating
  // the role is what the function's contract actually is.
  test('a person / creature unit routes to an entity', () => {
    expect(placementFor({ category: 'units', id: 'emoji:person', settings: { unitRole: 'person' } })).toBe('entity')
    expect(placementFor({ category: 'units', id: 'emoji:goblin', settings: { unitRole: 'enemy' } })).toBe('entity')
    expect(placementFor({ category: 'units', id: 'emoji:player', settings: { unitRole: 'person' } })).toBe('entity')
  })
  test('a combat-FX / projectile unit tile falls back to an asset (never a nonsense entity)', () => {
    // These are units-category by CATEGORY_OF but are NOT placeable figures.
    expect(placementFor({ category: 'units', id: 'emoji:arrow' })).toBe('asset')
    expect(placementFor({ category: 'units', id: 'emoji:fire-slash' })).toBe('asset')
  })
  test('an animal (now a unit, not nature) routes to an entity', () => {
    for (const id of ['emoji:bear', 'emoji:grey-wolf', 'emoji:fox', 'emoji:cow']) {
      expect(placementFor({ category: 'units', id, settings: { unitRole: 'animal' } })).toBe('entity')
    }
  })

  test('a units tile the catalog gave NO role is decoration, not a creature', () => {
    // The deleted slug lists used to guess here. A row with no role has not been described, and inventing
    // an answer is the thing the migration removed.
    expect(placementFor({ category: 'units', id: 'emoji:person', settings: {} })).toBe('asset')
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
      expect(entityKindForUnitTile(unitTile(slug, 'animal'))).toBe('enemy')
    }
  })
})

describe('entityKindForUnitTile — the kind comes from the served ROLE, not the name', () => {
  test('the explicit player slug → player, whatever its role says', () => {
    // The hero is the one figure identified by slug: its catalog row's role is `person` like any other.
    expect(entityKindForUnitTile(unitTile('player', 'person'))).toBe('player')
  })
  test('the person role → npc', () => {
    for (const slug of ['person', 'man', 'woman', 'old-man', 'wizard', 'guard', 'npc']) {
      expect(entityKindForUnitTile(unitTile(slug, 'person'))).toBe('npc')
    }
  })
  test('a tile with NO served role is not an entity — it is decoration', () => {
    // An `fx` tile (arrow, nova, fire-slash) is what a POWER draws, not a character.
    expect(entityKindForUnitTile(unitTile('nova'))).toBeNull()
    expect(entityKindForUnitTile(unitTile('arrow', 'fx'))).toBeNull()
  })
  test('the enemy role → enemy', () => {
    for (const slug of ['goblin', 'dragon', 'zombie', 'skeleton', 'enemy', 'boss']) {
      expect(entityKindForUnitTile(unitTile(slug, 'enemy'))).toBe('enemy')
    }
  })
})
