/**
 * Entity SPAWNER — scatter enemies / NPCs into a stage's free cells.
 *
 * PURE: no module-level mutable state, no clock. All randomness flows through an
 * injected `rng` (0–1) so a seeded rng reproduces a run exactly. Builds entities
 * via the shared factories in entities.ts, then attaches a movement pattern + the
 * runtime flags (hittable) the play loop expects.
 *
 * Enemies are placed GROUPED BY TYPE: the map is partitioned into a grid of zones
 * and each requested enemy type gets its own home zone, so wolves cluster in one
 * area, goblins in another, etc. — instead of every type clumping in one corner.
 */
import type { Entity, EntityKind, MovementPattern, Cell, Rarity } from '@/game/types'
import { makeEnemy, makeNpc, makePlayer } from '@/game/entities'
import { buildArchetypeProfile, type EnemyArchetypeId } from '@/game/archetypes'
import { chebyshev } from '@/lib/math'

/** The enemy roster a randomizer draws from (the tag 'kill' objectives count). */
export const ENEMY_TYPES = ['goblin', 'wolf', 'bandit', 'skeleton'] as const
export type EnemyType = (typeof ENEMY_TYPES)[number]

/** Each roster type maps to a distinct combat ARCHETYPE, so the type-grouped zones also
 *  vary by fighting style: goblins are basic grunts, wolves dart (skirmisher), bandits
 *  shoot (archer), skeletons hit like brutes. The archetype seeds the enemy's stats +
 *  attack pattern (see entities.makeEnemy). */
const ARCHETYPE_BY_ENEMY_TYPE: Record<EnemyType, EnemyArchetypeId> = {
  goblin: 'grunt',
  wolf: 'skirmisher',
  bandit: 'archer',
  skeleton: 'brute',
}

/** The archetype for a roster type, or undefined for an unknown/custom type (→ plain
 *  default mob). Exposed so the editor's manual placement varies enemies by type too. */
export function archetypeForEnemyType(type: string): EnemyArchetypeId | undefined {
  return (ARCHETYPE_BY_ENEMY_TYPE as Record<string, EnemyArchetypeId>)[type]
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
  /** enemy types to spread across the map, one home zone each; default ENEMY_TYPES. */
  enemyTypes?: readonly string[]
  /** rarity per enemy type (drives respawn time); types absent default to 'common'. */
  rarityByType?: Partial<Record<string, Rarity>>
}

const key = (col: number, row: number): string => `${col},${row}`
const pick = <T>(arr: readonly T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)]

/**
 * Scatter `count` entities onto distinct free cells. Pure + deterministic under `rng`.
 * Enemies cluster by type into per-type zones; NPCs/players fill the gaps. Spacing
 * (`minGap`) and obstacle/occupied avoidance hold GLOBALLY across every placement.
 */
export function scatterEntities(opts: ScatterOptions): Entity[] {
  const {
    collision, occupied = [], count, kinds = ['enemy'],
    rng = Math.random, idPrefix = 'spawn', minGap = 3,
    enemyTypes = ENEMY_TYPES, rarityByType,
  } = opts
  if (count <= 0 || kinds.length === 0) return []

  const gridRows = collision.length
  const gridCols = collision[0]?.length ?? 0

  const taken = new Set(occupied.map(o => key(o.col, o.row)))
  const free = collectFreeCells(collision, taken)
  if (free.length === 0) return []

  // Cells we can never place more than once on; spacing anchors carry pre-existing
  // occupied cells too so we keep our distance from the player and prior entities.
  const used = new Set<string>()
  const anchors: Cell[] = occupied.map(o => ({ col: o.col, row: o.row }))

  const n = Math.min(count, free.length)
  const slotKinds = Array.from({ length: n }, () => pick(kinds, rng))
  const enemyCount = slotKinds.filter(k => k === 'enemy').length
  const otherKinds = slotKinds.filter(k => k !== 'enemy')

  const out: Entity[] = placeEnemiesByType({
    free, used, anchors, count: enemyCount, types: enemyTypes,
    rarityByType, minGap, rng, idPrefix, collision, gridCols, gridRows,
  })

  // NPCs / players: plain spaced scatter into whatever cells are left.
  const pool = shuffle(free.filter(c => !used.has(key(c.col, c.row))), rng)
  for (const kind of otherKinds) {
    const cell = pool.find(c => !used.has(key(c.col, c.row)) && isSpaced(c, anchors, minGap))
    if (!cell) break
    used.add(key(cell.col, cell.row))
    anchors.push(cell)
    out.push(buildOther(kind, `${idPrefix}-${out.length}`, cell, out.length))
  }

  return out
}

interface PlaceEnemiesParams {
  free: Cell[]
  used: Set<string>
  anchors: Cell[]
  count: number
  types: readonly string[]
  rarityByType?: Partial<Record<string, Rarity>>
  minGap: number
  rng: () => number
  idPrefix: string
  collision: boolean[][]
  gridCols: number
  gridRows: number
}

/**
 * Place `count` enemies grouped by type. The map is partitioned into a near-square
 * grid of zones (≥ one per type); each type is scattered within its own zone so the
 * types stay visually separated. Quota a zone can't fit (too small / too cramped)
 * spills into any remaining free cell so we still reach `count` where capacity allows.
 */
function placeEnemiesByType(p: PlaceEnemiesParams): Entity[] {
  const { free, used, anchors, count, types, rarityByType, minGap, rng, idPrefix, collision, gridCols, gridRows } = p
  if (count <= 0 || types.length === 0) return []

  const zCols = Math.ceil(Math.sqrt(types.length))
  const zRows = Math.ceil(types.length / zCols)
  const zoneTotal = zCols * zRows
  const quotas = splitEvenly(count, types.length)

  const out: Entity[] = []
  const build = (type: string, cell: Cell): void => {
    used.add(key(cell.col, cell.row))
    out.push(buildEnemy(type, `${idPrefix}-${out.length}`, cell, rng, collision, rarityByType?.[type]))
  }

  // 1. each type within its own home zone
  types.forEach((type, t) => {
    if (quotas[t] <= 0) return
    const bounds = zoneBounds(t % zoneTotal, zCols, zRows, gridCols, gridRows)
    const inZone = free.filter(c => !used.has(key(c.col, c.row)) && within(c, bounds))
    for (const cell of takeSpaced(shuffle(inZone, rng), anchors, quotas[t], minGap)) build(type, cell)
  })

  // 2. spillover — quotas that didn't fit fall back to any free cell, types round-robin
  const remaining = count - out.length
  if (remaining > 0) {
    const pool = shuffle(free.filter(c => !used.has(key(c.col, c.row))), rng)
    takeSpaced(pool, anchors, remaining, minGap).forEach((cell, j) => build(types[j % types.length], cell))
  }

  return out
}

/** Distribute `total` across `parts` as evenly as possible (earlier parts get the remainder). */
function splitEvenly(total: number, parts: number): number[] {
  const base = Math.floor(total / parts)
  const rem = total % parts
  return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0))
}

interface Bounds {
  colMin: number
  colMax: number
  rowMin: number
  rowMax: number
}

/** The cell rectangle owned by `zone` when the grid is split into zCols×zRows zones. */
function zoneBounds(zone: number, zCols: number, zRows: number, gridCols: number, gridRows: number): Bounds {
  const zc = zone % zCols
  const zr = Math.floor(zone / zCols)
  return {
    colMin: Math.floor((zc * gridCols) / zCols),
    colMax: Math.floor(((zc + 1) * gridCols) / zCols) - 1,
    rowMin: Math.floor((zr * gridRows) / zRows),
    rowMax: Math.floor(((zr + 1) * gridRows) / zRows) - 1,
  }
}

const within = (c: Cell, b: Bounds): boolean =>
  c.col >= b.colMin && c.col <= b.colMax && c.row >= b.rowMin && c.row <= b.rowMax

const isSpaced = (c: Cell, anchors: readonly Cell[], minGap: number): boolean =>
  minGap <= 1 || anchors.every(a => chebyshev(c, a) >= minGap)

/** Greedily accept candidates (already shuffled) that sit ≥ `minGap` (chebyshev) from
 *  every existing anchor AND from each other. Accepted cells are pushed into `anchors`
 *  so later calls stay globally spaced. A single pass is the bounded "retry". */
function takeSpaced(candidates: Cell[], anchors: Cell[], count: number, minGap: number): Cell[] {
  const accepted: Cell[] = []
  for (const c of candidates) {
    if (accepted.length >= count) break
    if (!isSpaced(c, anchors, minGap)) continue
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

/** Build a clustered enemy of `type`: archetype stats + attack pattern, rarity-driven
 *  respawn (set in makeEnemy), hittable, and a small patrol around its spawn paced by the
 *  archetype's move speed (brutes lumber, skirmishers dart). */
function buildEnemy(
  type: string,
  id: string,
  cell: Cell,
  rng: () => number,
  collision: boolean[][],
  rarity?: Rarity,
): Entity {
  const archetype = archetypeForEnemyType(type)
  const enemy = makeEnemy(id, cell.col, cell.row, type, { archetype, rarity })
  const moveDelayMs = archetype ? buildArchetypeProfile(archetype).moveDelayMs : undefined
  return { ...enemy, hittable: true, movement: makePatrol(cell, rng, collision, moveDelayMs) }
}

/** Build a non-enemy (npc/player) — not type-grouped; just named + placed. */
function buildOther(kind: EntityKind, id: string, cell: Cell, index: number): Entity {
  if (kind === 'player') return makePlayer(id, cell.col, cell.row, `Hero ${index + 1}`)
  return { ...makeNpc(id, cell.col, cell.row, { name: `Wanderer ${index + 1}` }), hittable: false }
}

const isFree = (collision: boolean[][], col: number, row: number): boolean =>
  row >= 0 && row < collision.length && col >= 0 && col < (collision[row]?.length ?? 0) && !collision[row][col]

/** A random patrol of 3–4 waypoints jittered ±2 cells around the spawn, keeping
 *  only walkable, in-bounds cells. The spawn itself is always waypoint 0, so the
 *  pattern always has ≥1 waypoint. `delayMs` (the archetype's move cadence) paces the
 *  patrol when given; omitted → the engine's default step delay. */
function makePatrol(spawn: Cell, rng: () => number, collision: boolean[][], delayMs?: number): MovementPattern {
  const waypoints: Cell[] = [{ ...spawn }]
  const extra = 3 + Math.floor(rng() * 2) // 3 or 4 attempts
  for (let k = 0; k < extra; k++) {
    const col = spawn.col + (Math.floor(rng() * 5) - 2)
    const row = spawn.row + (Math.floor(rng() * 5) - 2)
    if (isFree(collision, col, row)) waypoints.push({ col, row })
  }
  return { mode: 'random', waypoints, ...(delayMs != null ? { delayMs } : {}) }
}
