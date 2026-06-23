/**
 * Entity SPAWNER — scatter enemies / NPCs into a stage's free cells.
 *
 * PURE: no module-level mutable state, no clock. All randomness flows through an
 * injected `rng` (0–1) so a seeded rng reproduces a run exactly. Builds entities
 * via the shared factories in entities.ts, then attaches a movement pattern + the
 * runtime flags (hittable) the play loop expects.
 */
import type { Entity, EntityKind, Stats, MovementPattern, Cell } from '@/game/types'
import { makeEnemy, makeNpc, makePlayer } from '@/game/entities'

/** The enemy roster a randomizer draws from (the tag 'kill' objectives count). */
export const ENEMY_TYPES = ['goblin', 'wolf', 'bandit', 'skeleton'] as const
export type EnemyType = (typeof ENEMY_TYPES)[number]

/** Per-type stat flavour, merged over the enemy defaults. */
const ENEMY_STATS: Record<EnemyType, Partial<Stats>> = {
  goblin: { maxHp: 28, strength: 5, defense: 2, dodge: 5 },
  wolf: { maxHp: 22, strength: 7, defense: 1, dodge: 15 },
  bandit: { maxHp: 34, strength: 6, defense: 3, dodge: 8 },
  skeleton: { maxHp: 30, strength: 4, defense: 4, dodge: 2 },
}

export interface ScatterOptions {
  /** [row][col]; true = blocked. */
  collision: boolean[][]
  /** cells already taken (existing entities / player) to avoid. */
  occupied?: ReadonlyArray<{ col: number; row: number }>
  /** how many to place (capped at the number of free cells). */
  count: number
  /** kinds to draw from; default ['enemy']. */
  kinds?: EntityKind[]
  /** RNG (0–1); default Math.random. */
  rng?: () => number
  /** id prefix for the generated entities; default 'spawn'. */
  idPrefix?: string
  /** minimum chebyshev spacing between placed entities (and from pre-existing
   *  occupied cells); default 3 → enemies spread out instead of clumping. Set 0
   *  to pack tightly. May place fewer than `count` when the stage can't fit them. */
  minGap?: number
}

const key = (col: number, row: number): string => `${col},${row}`
const pick = <T>(arr: readonly T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)]

/** Scatter `count` entities onto distinct free cells. Pure + deterministic under `rng`. */
export function scatterEntities(opts: ScatterOptions): Entity[] {
  const { collision, occupied = [], count, kinds = ['enemy'], rng = Math.random, idPrefix = 'spawn', minGap = 3 } = opts
  if (count <= 0 || kinds.length === 0) return []

  const taken = new Set(occupied.map(o => key(o.col, o.row)))
  const free = collectFreeCells(collision, taken)
  const chosen = pickSpaced(shuffle(free, rng), occupied, count, minGap)

  return chosen.map((cell, i) => buildEntity(pick(kinds, rng), `${idPrefix}-${i}`, cell, i, rng, collision))
}

const chebyshev = (a: Cell, b: { col: number; row: number }): number =>
  Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row))

/** Greedily accept shuffled candidates that sit ≥ `minGap` (chebyshev) from every
 *  already-accepted cell AND every pre-existing occupied cell. A single pass over the
 *  shuffled list is the bounded "retry": each candidate is one attempt. `minGap <= 1`
 *  falls back to plain distinct packing (old behaviour). */
function pickSpaced(
  candidates: Cell[],
  occupied: ReadonlyArray<{ col: number; row: number }>,
  count: number,
  minGap: number,
): Cell[] {
  if (minGap <= 1) return candidates.slice(0, Math.min(count, candidates.length))
  const anchors: { col: number; row: number }[] = occupied.map(o => ({ col: o.col, row: o.row }))
  const accepted: Cell[] = []
  for (const c of candidates) {
    if (accepted.length >= count) break
    if (anchors.some(a => chebyshev(c, a) < minGap)) continue
    accepted.push(c)
    anchors.push(c)
  }
  return accepted
}

function collectFreeCells(collision: boolean[][], taken: Set<string>): Cell[] {
  const free: Cell[] = []
  for (let row = 0; row < collision.length; row++) {
    const width = collision[row]?.length ?? 0
    for (let col = 0; col < width; col++) {
      if (collision[row][col]) continue
      if (taken.has(key(col, row))) continue
      free.push({ col, row })
    }
  }
  return free
}

/** Fisher–Yates with the injected rng (does not mutate the input). */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function buildEntity(kind: EntityKind, id: string, cell: Cell, index: number, rng: () => number, collision: boolean[][]): Entity {
  if (kind === 'player') return makePlayer(id, cell.col, cell.row, `Hero ${index + 1}`)
  if (kind === 'npc') return { ...makeNpc(id, cell.col, cell.row, { name: `Wanderer ${index + 1}` }), hittable: false }

  const type = pick(ENEMY_TYPES, rng)
  const enemy = makeEnemy(id, cell.col, cell.row, type, { stats: ENEMY_STATS[type], respawnMs: 8000 })
  return { ...enemy, hittable: true, movement: makePatrol(cell, rng, collision) }
}

const isFree = (collision: boolean[][], col: number, row: number): boolean =>
  row >= 0 && row < collision.length && col >= 0 && col < (collision[row]?.length ?? 0) && !collision[row][col]

/** A random patrol of 3–4 waypoints jittered ±2 cells around the spawn, keeping
 *  only walkable, in-bounds cells. The spawn itself is always waypoint 0, so the
 *  pattern always has ≥1 waypoint. */
function makePatrol(spawn: Cell, rng: () => number, collision: boolean[][]): MovementPattern {
  const waypoints: Cell[] = [{ ...spawn }]
  const extra = 3 + Math.floor(rng() * 2) // 3 or 4 attempts
  for (let k = 0; k < extra; k++) {
    const col = spawn.col + (Math.floor(rng() * 5) - 2)
    const row = spawn.row + (Math.floor(rng() * 5) - 2)
    if (isFree(collision, col, row)) waypoints.push({ col, row })
  }
  return { mode: 'random', waypoints }
}
