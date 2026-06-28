import { scatterEntities, ENEMY_TYPES } from '@/game/spawner'
import { RESPAWN_MS_BY_RARITY, respawnMsForRarity } from '@/game/types'
import type { Entity } from '@/game/types'

// open [row][col] grid, all walkable
const openGrid = (cols: number, rows: number): boolean[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => false))

// deterministic LCG in [0,1) so a seed reproduces a run
const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('scatterEntities — scatter into free cells', () => {
  it('places `count` enemies on distinct, walkable, unoccupied cells', () => {
    const grid = openGrid(10, 10)
    const ents = scatterEntities({ collision: grid, count: 5, rng: seeded(1), minGap: 0 })
    expect(ents).toHaveLength(5)
    const cells = new Set(ents.map(e => `${e.col},${e.row}`))
    expect(cells.size).toBe(5) // all distinct
    for (const e of ents) {
      expect(grid[e.row][e.col]).toBe(false) // walkable
      expect(e.kind).toBe('enemy')
    }
  })

  it('never lands on an occupied cell', () => {
    const grid = openGrid(3, 3) // 9 cells
    const occupied = [{ col: 0, row: 0 }, { col: 1, row: 1 }]
    const ents = scatterEntities({ collision: grid, count: 7, occupied, rng: seeded(2), minGap: 0 })
    const occSet = new Set(occupied.map(o => `${o.col},${o.row}`))
    for (const e of ents) expect(occSet.has(`${e.col},${e.row}`)).toBe(false)
    expect(ents).toHaveLength(7) // 9 − 2 occupied
  })

  it('caps the count at the number of free cells', () => {
    const ents = scatterEntities({ collision: openGrid(2, 2), count: 100, rng: seeded(3), minGap: 0 })
    expect(ents).toHaveLength(4)
  })

  it('gives every enemy an enemyType + a movement pattern with ≥1 waypoint + hittable', () => {
    const ents = scatterEntities({ collision: openGrid(12, 12), count: 6, rng: seeded(4) })
    for (const e of ents) {
      expect(typeof e.enemyType).toBe('string')
      expect(e.enemyType!.length).toBeGreaterThan(0)
      expect(e.movement).toBeDefined()
      expect(e.movement!.waypoints.length).toBeGreaterThanOrEqual(1)
      expect(e.hittable).toBe(true)
    }
  })

  it('is reproducible under a fixed seed', () => {
    const opts = { collision: openGrid(10, 10), count: 5, kinds: ['enemy', 'npc'] as const }
    const key = (e: { kind: string; col: number; row: number; enemyType?: string; name?: string }) =>
      `${e.kind}:${e.col},${e.row}:${e.enemyType ?? e.name}`
    const a = scatterEntities({ ...opts, kinds: ['enemy', 'npc'], rng: seeded(42) }).map(key)
    const b = scatterEntities({ ...opts, kinds: ['enemy', 'npc'], rng: seeded(42) }).map(key)
    expect(a).toEqual(b)
  })

  it('returns [] for a fully blocked grid', () => {
    const blocked = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => true))
    expect(scatterEntities({ collision: blocked, count: 3, rng: seeded(5) })).toEqual([])
  })

  it('npcs are non-hittable, named, with no enemyType', () => {
    const ents = scatterEntities({ collision: openGrid(8, 8), count: 8, kinds: ['npc'], rng: seeded(6) })
    for (const e of ents) {
      expect(e.kind).toBe('npc')
      expect(e.hittable).toBe(false)
      expect(e.enemyType).toBeUndefined()
      expect(e.name).toBeTruthy()
    }
  })

  it('spaces placed entities at least minGap apart (chebyshev)', () => {
    const cheb = (a: { col: number; row: number }, b: { col: number; row: number }) =>
      Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row))
    for (const minGap of [3, 5]) {
      const ents = scatterEntities({ collision: openGrid(40, 40), count: 8, rng: seeded(11), minGap })
      expect(ents.length).toBeGreaterThan(1)
      expect(ents.length).toBeLessThanOrEqual(8)
      for (let i = 0; i < ents.length; i++) {
        for (let j = i + 1; j < ents.length; j++) {
          expect(cheb(ents[i], ents[j])).toBeGreaterThanOrEqual(minGap)
        }
      }
    }
  })

  it('respects spacing from pre-existing occupied cells', () => {
    const occupied = [{ col: 10, row: 10 }]
    const ents = scatterEntities({ collision: openGrid(40, 40), count: 6, occupied, rng: seeded(12), minGap: 4 })
    for (const e of ents) {
      expect(Math.max(Math.abs(e.col - 10), Math.abs(e.row - 10))).toBeGreaterThanOrEqual(4)
    }
  })

  it('keeps every enemy waypoint walkable and in-bounds', () => {
    const grid = openGrid(10, 10)
    const ents = scatterEntities({ collision: grid, count: 8, rng: seeded(7) })
    for (const e of ents) {
      for (const wp of e.movement!.waypoints) {
        expect(wp.row).toBeGreaterThanOrEqual(0)
        expect(wp.row).toBeLessThan(10)
        expect(wp.col).toBeGreaterThanOrEqual(0)
        expect(wp.col).toBeLessThan(10)
        expect(grid[wp.row][wp.col]).toBe(false)
      }
    }
  })
})

// ── helpers for the clustering assertions ───────────────────────────────
const cheb = (a: { col: number; row: number }, b: { col: number; row: number }) =>
  Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row))

const groupByType = (ents: Entity[]): Map<string, Entity[]> => {
  const groups = new Map<string, Entity[]>()
  for (const e of ents) {
    const t = e.enemyType!
    if (!groups.has(t)) groups.set(t, [])
    groups.get(t)!.push(e)
  }
  return groups
}

const centroid = (ents: Entity[]) => ({
  col: ents.reduce((s, e) => s + e.col, 0) / ents.length,
  row: ents.reduce((s, e) => s + e.row, 0) / ents.length,
})

const meanPairwise = (pairs: number[]) => pairs.reduce((s, d) => s + d, 0) / pairs.length

describe('scatterEntities — enemies grouped by type into zones', () => {
  it('keeps each enemy type in its own bounded region (clustered, not scattered map-wide)', () => {
    const grid = openGrid(60, 60)
    const ents = scatterEntities({ collision: grid, count: 24, rng: seeded(21) })
    const groups = groupByType(ents)

    // multiple distinct types should be present, each grouped together
    expect(groups.size).toBeGreaterThanOrEqual(2)

    for (const [, members] of groups) {
      const cols = members.map(e => e.col)
      const rows = members.map(e => e.row)
      const extent = Math.max(Math.max(...cols) - Math.min(...cols), Math.max(...rows) - Math.min(...rows))
      // a clustered type lives in one zone (~half the map per axis), far under the
      // full 59-cell span. 60% of the map is a generous ceiling.
      expect(extent).toBeLessThanOrEqual(Math.round(60 * 0.6))
    }
  })

  it('clusters tighter within a type than between types', () => {
    const grid = openGrid(60, 60)
    const ents = scatterEntities({ collision: grid, count: 24, rng: seeded(22) })
    const groups = [...groupByType(ents).values()].filter(g => g.length >= 2)
    expect(groups.length).toBeGreaterThanOrEqual(2)

    const intra: number[] = []
    for (const g of groups) {
      for (let i = 0; i < g.length; i++) {
        for (let j = i + 1; j < g.length; j++) intra.push(cheb(g[i], g[j]))
      }
    }
    const inter: number[] = []
    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        for (const x of groups[a]) for (const y of groups[b]) inter.push(cheb(x, y))
      }
    }
    // same-type members sit closer together than members of different types
    expect(meanPairwise(intra)).toBeLessThan(meanPairwise(inter))
  })

  it('puts each enemy type in its own quadrant of the map (distinct home zones)', () => {
    const grid = openGrid(60, 60)
    const ents = scatterEntities({ collision: grid, count: 24, rng: seeded(23) })
    const groups = groupByType(ents)
    expect(groups.size).toBe(ENEMY_TYPES.length) // all four types placed

    // each type's centroid should fall in a different 30×30 quadrant
    const quadrant = (c: { col: number; row: number }) => (c.row < 30 ? 0 : 2) + (c.col < 30 ? 0 : 1)
    const quads = [...groups.values()].map(members => quadrant(centroid(members)))
    expect(new Set(quads).size).toBe(groups.size)
  })
})

describe('scatterEntities — rarity-driven respawn', () => {
  it('gives every spawned enemy a positive respawnMs taken from its rarity', () => {
    const ents = scatterEntities({ collision: openGrid(40, 40), count: 12, rng: seeded(31) })
    for (const e of ents) {
      expect(e.respawnMs).toBeGreaterThan(0)
      expect(e.respawnMs).toBe(respawnMsForRarity(e.rarity))
    }
  })

  it('honours a per-type rarity → distinct respawn times per type', () => {
    const rarityByType = { goblin: 'common', wolf: 'uncommon', bandit: 'rare', skeleton: 'elite' } as const
    const ents = scatterEntities({
      collision: openGrid(60, 60),
      count: 24,
      rng: seeded(32),
      rarityByType,
    })
    expect(ents.length).toBeGreaterThan(0)
    for (const e of ents) {
      const expected = rarityByType[e.enemyType as keyof typeof rarityByType]
      expect(e.rarity).toBe(expected)
      expect(e.respawnMs).toBe(RESPAWN_MS_BY_RARITY[expected])
    }
  })

  it('defaults missing types to common rarity', () => {
    const ents = scatterEntities({
      collision: openGrid(40, 40),
      count: 8,
      rng: seeded(33),
      enemyTypes: ['goblin'],
      // no rarityByType → common
    })
    for (const e of ents) {
      expect(e.respawnMs).toBe(RESPAWN_MS_BY_RARITY.common)
    }
  })
})

describe('scatterEntities — never overlaps or lands on blocked cells', () => {
  it('places every enemy on a free, distinct cell even with obstacles', () => {
    const grid = openGrid(30, 30)
    // sprinkle some blocked cells (roads/buildings/water stand-ins)
    for (let r = 0; r < 30; r++) for (let c = 0; c < 30; c++) {
      if ((c * 7 + r * 13) % 5 === 0) grid[r][c] = true
    }
    const ents = scatterEntities({ collision: grid, count: 20, rng: seeded(41) })
    const seen = new Set<string>()
    for (const e of ents) {
      expect(grid[e.row][e.col]).toBe(false) // walkable
      const k = `${e.col},${e.row}`
      expect(seen.has(k)).toBe(false) // no overlap
      seen.add(k)
    }
    expect(ENEMY_TYPES.length).toBeGreaterThan(0)
  })
})
