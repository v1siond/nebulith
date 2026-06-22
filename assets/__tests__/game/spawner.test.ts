import { scatterEntities } from '@/game/spawner'

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
    const ents = scatterEntities({ collision: grid, count: 5, rng: seeded(1) })
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
    const ents = scatterEntities({ collision: grid, count: 7, occupied, rng: seeded(2) })
    const occSet = new Set(occupied.map(o => `${o.col},${o.row}`))
    for (const e of ents) expect(occSet.has(`${e.col},${e.row}`)).toBe(false)
    expect(ents).toHaveLength(7) // 9 − 2 occupied
  })

  it('caps the count at the number of free cells', () => {
    const ents = scatterEntities({ collision: openGrid(2, 2), count: 100, rng: seeded(3) })
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
