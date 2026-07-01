import {
  makePlayer,
  makeEnemy,
  makeNpc,
  canPlaceEntity,
  placeEntity,
  removeEntity,
  entityAt,
  entityAtFootprint,
  entityOccupiedCells,
  entityCollisionCells,
  isRespawned,
  nextRespawnAt,
  DEFAULT_RESPAWN_MS,
  byKind,
  enemiesOfType,
  DEFAULT_PLAYER_STATS,
  DEFAULT_ENEMY_STATS,
  DEFAULT_NPC_STATS,
} from '@/game/entities'
import type { Entity } from '@/game/types'
import { RESPAWN_MS_BY_RARITY, respawnMsForRarity } from '@/game/types'

/** A collision predicate that blocks a fixed set of "col,row" cells. */
function blockedCells(...cells: Array<[number, number]>) {
  const set = new Set(cells.map(([c, r]) => `${c},${r}`))
  return (col: number, row: number) => set.has(`${col},${row}`)
}

/** Collision predicate that never blocks (open field). */
const noCollision = () => false

describe('entity factories', () => {
  it('makePlayer sets kind=player, position, and sane player stats', () => {
    const p = makePlayer('p1', 3, 4)
    expect(p.id).toBe('p1')
    expect(p.kind).toBe('player')
    expect(p.col).toBe(3)
    expect(p.row).toBe(4)
    expect(p.baseStats).toEqual(DEFAULT_PLAYER_STATS)
    expect(p.baseStats.maxHp).toBeGreaterThan(0)
    // a player is not an enemy/npc, so no respawn / quest / enemyType tags
    expect(p.respawnMs).toBeUndefined()
    expect(p.questId).toBeUndefined()
    expect(p.enemyType).toBeUndefined()
  })

  it('makePlayer accepts an optional name', () => {
    expect(makePlayer('p1', 0, 0).name).toBeUndefined()
    expect(makePlayer('p1', 0, 0, 'Hero').name).toBe('Hero')
  })

  it('makeEnemy sets kind=enemy, enemyType, and sane enemy stats', () => {
    const e = makeEnemy('e1', 5, 6, 'goblin')
    expect(e.kind).toBe('enemy')
    expect(e.col).toBe(5)
    expect(e.row).toBe(6)
    expect(e.enemyType).toBe('goblin')
    expect(e.baseStats).toEqual(DEFAULT_ENEMY_STATS)
    expect(e.baseStats.maxHp).toBeGreaterThan(0)
  })

  it('makeEnemy carries an optional respawnMs so kill-quests stay farmable', () => {
    expect(makeEnemy('e1', 0, 0, 'goblin').respawnMs).toBe(DEFAULT_RESPAWN_MS) // defaults to the common rarity (~20s)
    expect(makeEnemy('e1', 0, 0, 'goblin', { respawnMs: 30_000 }).respawnMs).toBe(30_000)
  })

  it('makeEnemy takes its respawn from rarity when no explicit respawnMs is given', () => {
    const elite = makeEnemy('e1', 0, 0, 'dragon', { rarity: 'elite' })
    expect(elite.rarity).toBe('elite')
    expect(elite.respawnMs).toBe(RESPAWN_MS_BY_RARITY.elite) // 120s — rares take longer to return

    const rare = makeEnemy('e2', 0, 0, 'troll', { rarity: 'rare' })
    expect(rare.respawnMs).toBe(RESPAWN_MS_BY_RARITY.rare)

    // an explicit respawnMs always wins over the rarity default
    expect(makeEnemy('e3', 0, 0, 'goblin', { rarity: 'elite', respawnMs: 1_000 }).respawnMs).toBe(1_000)
  })

  it('makeEnemy with no rarity defaults to the common respawn', () => {
    const e = makeEnemy('e1', 0, 0, 'goblin')
    expect(e.respawnMs).toBe(RESPAWN_MS_BY_RARITY.common)
  })

  it('makeEnemy can override stats and name', () => {
    const e = makeEnemy('boss', 0, 0, 'dragon', {
      name: 'Old Wyrm',
      stats: { maxHp: 500 },
    })
    expect(e.name).toBe('Old Wyrm')
    expect(e.baseStats.maxHp).toBe(500)
    // unspecified stats fall back to the enemy defaults
    expect(e.baseStats.strength).toBe(DEFAULT_ENEMY_STATS.strength)
  })

  it('makeNpc sets kind=npc and sane npc stats', () => {
    const n = makeNpc('n1', 2, 2)
    expect(n.kind).toBe('npc')
    expect(n.col).toBe(2)
    expect(n.row).toBe(2)
    expect(n.baseStats).toEqual(DEFAULT_NPC_STATS)
    expect(n.questId).toBeUndefined()
  })

  it('makeNpc carries an optional questId (quest giver)', () => {
    expect(makeNpc('n1', 0, 0, { questId: 'q-slay-goblins' }).questId).toBe('q-slay-goblins')
  })

  it('makeNpc accepts an optional name', () => {
    expect(makeNpc('n1', 0, 0, { name: 'Elder' }).name).toBe('Elder')
  })
})

describe('canPlaceEntity — placement guards', () => {
  const grid = { cols: 10, rows: 8 }

  it('allows an in-bounds, unblocked, unoccupied cell', () => {
    expect(canPlaceEntity([], 4, 4, grid.cols, grid.rows, noCollision)).toBe(true)
  })

  it('rejects a negative column (out of bounds)', () => {
    expect(canPlaceEntity([], -1, 4, grid.cols, grid.rows, noCollision)).toBe(false)
  })

  it('rejects a negative row (out of bounds)', () => {
    expect(canPlaceEntity([], 4, -1, grid.cols, grid.rows, noCollision)).toBe(false)
  })

  it('rejects a column at/over the width (out of bounds, exclusive)', () => {
    expect(canPlaceEntity([], 10, 4, grid.cols, grid.rows, noCollision)).toBe(false)
  })

  it('rejects a row at/over the height (out of bounds, exclusive)', () => {
    expect(canPlaceEntity([], 4, 8, grid.cols, grid.rows, noCollision)).toBe(false)
  })

  it('rejects a blocked (collision) cell', () => {
    const collision = blockedCells([4, 4])
    expect(canPlaceEntity([], 4, 4, grid.cols, grid.rows, collision)).toBe(false)
  })

  it('rejects a cell already occupied by another entity', () => {
    const existing = [makeEnemy('e1', 4, 4, 'goblin')]
    expect(canPlaceEntity(existing, 4, 4, grid.cols, grid.rows, noCollision)).toBe(false)
  })

  it('allows a free cell even when other entities exist elsewhere', () => {
    const existing = [makeEnemy('e1', 1, 1, 'goblin'), makePlayer('p1', 2, 2)]
    expect(canPlaceEntity(existing, 4, 4, grid.cols, grid.rows, noCollision)).toBe(true)
  })
})

describe('placeEntity — immutable insert', () => {
  it('returns a NEW list with the entity appended (does not mutate the input)', () => {
    const before: Entity[] = [makePlayer('p1', 1, 1)]
    const enemy = makeEnemy('e1', 4, 4, 'goblin')
    const after = placeEntity(before, enemy)

    expect(after).not.toBe(before)
    expect(before).toHaveLength(1)
    expect(after).toHaveLength(2)
    expect(after).toContain(enemy)
  })
})

describe('removeEntity — immutable delete', () => {
  it('returns a NEW list without the matching id (does not mutate the input)', () => {
    const before: Entity[] = [makePlayer('p1', 1, 1), makeEnemy('e1', 4, 4, 'goblin')]
    const after = removeEntity(before, 'e1')

    expect(after).not.toBe(before)
    expect(before).toHaveLength(2)
    expect(after).toHaveLength(1)
    expect(after.find(e => e.id === 'e1')).toBeUndefined()
    expect(after[0].id).toBe('p1')
  })

  it('returns an equivalent NEW list when the id is absent (no-op, still immutable)', () => {
    const before: Entity[] = [makePlayer('p1', 1, 1)]
    const after = removeEntity(before, 'missing')

    expect(after).not.toBe(before)
    expect(after).toEqual(before)
  })
})

describe('entityAt — cell lookup', () => {
  const list: Entity[] = [
    makePlayer('p1', 1, 1),
    makeEnemy('e1', 4, 4, 'goblin'),
  ]

  it('returns the entity occupying a cell', () => {
    expect(entityAt(list, 4, 4)?.id).toBe('e1')
  })

  it('returns null for an empty cell', () => {
    expect(entityAt(list, 9, 9)).toBeNull()
  })
})

describe('respawn timing — pure, time passed in', () => {
  const diedAt = 1_000
  const respawnMs = 5_000

  it('nextRespawnAt is death time + respawn delay', () => {
    expect(nextRespawnAt(diedAt, respawnMs)).toBe(6_000)
  })

  it('isRespawned is false before the delay has elapsed', () => {
    expect(isRespawned(diedAt, respawnMs, diedAt + respawnMs - 1)).toBe(false)
  })

  it('isRespawned is true exactly when the delay has elapsed', () => {
    expect(isRespawned(diedAt, respawnMs, diedAt + respawnMs)).toBe(true)
  })

  it('isRespawned is true after the delay has elapsed', () => {
    expect(isRespawned(diedAt, respawnMs, diedAt + respawnMs + 1)).toBe(true)
  })

  it('a non-respawning enemy (no/zero respawn delay) never respawns', () => {
    expect(isRespawned(diedAt, undefined, Number.MAX_SAFE_INTEGER)).toBe(false)
    expect(isRespawned(diedAt, 0, Number.MAX_SAFE_INTEGER)).toBe(false)
  })
})

describe('rarity → respawn timing', () => {
  it('respawn time grows with rarity (regulars come back fastest)', () => {
    const { common, uncommon, rare, elite } = RESPAWN_MS_BY_RARITY
    expect(common).toBeLessThan(uncommon)
    expect(uncommon).toBeLessThan(rare)
    expect(rare).toBeLessThan(elite)
    // regulars in the ~15–30s range
    expect(common).toBeGreaterThanOrEqual(15_000)
    expect(common).toBeLessThanOrEqual(30_000)
  })

  it('respawnMsForRarity maps each rarity to its delay', () => {
    expect(respawnMsForRarity('common')).toBe(RESPAWN_MS_BY_RARITY.common)
    expect(respawnMsForRarity('uncommon')).toBe(RESPAWN_MS_BY_RARITY.uncommon)
    expect(respawnMsForRarity('rare')).toBe(RESPAWN_MS_BY_RARITY.rare)
    expect(respawnMsForRarity('elite')).toBe(RESPAWN_MS_BY_RARITY.elite)
  })

  it('respawnMsForRarity defaults to common when no rarity is given', () => {
    expect(respawnMsForRarity()).toBe(RESPAWN_MS_BY_RARITY.common)
    expect(respawnMsForRarity(undefined)).toBe(RESPAWN_MS_BY_RARITY.common)
  })
})

describe('query helpers', () => {
  const player = makePlayer('p1', 0, 0)
  const goblinA = makeEnemy('e1', 1, 1, 'goblin')
  const goblinB = makeEnemy('e2', 2, 2, 'goblin')
  const wolf = makeEnemy('e3', 3, 3, 'wolf')
  const npc = makeNpc('n1', 4, 4)
  const all: Entity[] = [player, goblinA, goblinB, wolf, npc]

  it('byKind filters to a single kind', () => {
    expect(byKind(all, 'enemy')).toEqual([goblinA, goblinB, wolf])
    expect(byKind(all, 'player')).toEqual([player])
    expect(byKind(all, 'npc')).toEqual([npc])
  })

  it('byKind returns an empty list when none match', () => {
    expect(byKind([player], 'enemy')).toEqual([])
  })

  it('enemiesOfType filters enemies by their enemyType tag', () => {
    expect(enemiesOfType(all, 'goblin')).toEqual([goblinA, goblinB])
    expect(enemiesOfType(all, 'wolf')).toEqual([wolf])
  })

  it('enemiesOfType ignores non-enemy entities even if a type were to collide', () => {
    expect(enemiesOfType(all, 'goblin')).not.toContain(player)
    expect(enemiesOfType(all, 'goblin')).not.toContain(npc)
  })

  it('enemiesOfType returns an empty list for an unknown type', () => {
    expect(enemiesOfType(all, 'dragon')).toEqual([])
  })
})

describe('entityAtFootprint — clicking any cell of a multi-cell figure selects it', () => {
  it('an NPC (2 cells tall) is hit at its anchor AND the cell above (its head)', () => {
    const npc = makeNpc('n1', 5, 6, { name: 'Elder' }) // footprint 1×2, bottom-anchored
    const list = [npc]
    expect(entityAtFootprint(list, 5, 6)).toBe(npc) // anchor (feet)
    expect(entityAtFootprint(list, 5, 5)).toBe(npc) // head — the cell ABOVE the anchor
    expect(entityAtFootprint(list, 5, 4)).toBeNull() // above the footprint → miss
    expect(entityAtFootprint(list, 6, 6)).toBeNull() // beside it (1 wide) → miss
  })

  it('a 2-wide monster is hit across its width', () => {
    const goblin = makeEnemy('g1', 3, 3, 'goblin') // footprint 2×2
    const list = [goblin]
    expect(entityAtFootprint(list, 3, 3)).toBe(goblin)
    expect(entityAtFootprint(list, 4, 3)).toBe(goblin) // the right column of the figure
    expect(entityAtFootprint(list, 3, 2)).toBe(goblin) // its upper row
  })

  it('returns null when no figure covers the cell', () => {
    expect(entityAtFootprint([makeNpc('n1', 0, 0, {})], 9, 9)).toBeNull()
  })
})

describe('entityOccupiedCells — full-footprint collision blocks', () => {
  it('an NPC (1 wide, 2 tall, bottom-anchored) blocks its anchor AND the cell above', () => {
    const cells = entityOccupiedCells([makeNpc('n1', 5, 5, {})])
    expect(cells.has('5,5')).toBe(true) // feet / anchor
    expect(cells.has('5,4')).toBe(true) // head
    expect(cells.size).toBe(2)
  })

  it('a 2-wide monster (goblin) blocks both of its columns', () => {
    const cells = entityOccupiedCells([makeEnemy('g1', 5, 5, 'goblin')])
    // goblin footprint is 2x2 (centered horizontally, bottom-anchored)
    expect(cells.has('5,5')).toBe(true)
    expect(cells.has('6,5')).toBe(true)
    expect(cells.has('5,4')).toBe(true)
    expect(cells.has('6,4')).toBe(true)
  })

  it('an excluded entity (e.g. a dead enemy or the player) blocks nothing', () => {
    const player = makePlayer('p1', 5, 5)
    const enemy = makeEnemy('e1', 8, 8, 'goblin')
    const cells = entityOccupiedCells([player, enemy], e => e.id === 'p1' || e.id === 'e1')
    expect(cells.size).toBe(0)
  })

  it('only the non-excluded entities contribute their footprints', () => {
    const npc = makeNpc('n1', 2, 2, {})
    const enemy = makeEnemy('e1', 9, 9, 'goblin')
    const cells = entityOccupiedCells([npc, enemy], e => e.kind === 'enemy')
    expect(cells.has('2,2')).toBe(true)
    expect(cells.has('9,9')).toBe(false) // enemy excluded
  })
})

describe('entityCollisionCells — base-row only (walk around a tall enemy)', () => {
  it("blocks only the enemy's FEET row, not the billboard cells above it", () => {
    const cells = entityCollisionCells([makeEnemy('g1', 5, 5, 'goblin')])
    expect(cells.has('5,5')).toBe(true) // feet
    expect(cells.has('6,5')).toBe(true) // feet (2 wide)
    expect(cells.has('5,4')).toBe(false) // ABOVE the feet → walkable (the fix)
    expect(cells.has('6,4')).toBe(false)
    expect(cells.size).toBe(2)
  })
  it('a 1-wide npc blocks a single cell (not the head cell above)', () => {
    const cells = entityCollisionCells([makeNpc('n1', 5, 5, {})])
    expect(cells.has('5,5')).toBe(true)
    expect(cells.has('5,4')).toBe(false)
    expect(cells.size).toBe(1)
  })
  it('respects the exclude predicate (dead/self)', () => {
    const cells = entityCollisionCells([makeEnemy('e1', 8, 8, 'goblin')], () => true)
    expect(cells.size).toBe(0)
  })
})
