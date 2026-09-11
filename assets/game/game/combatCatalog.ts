/**
 * THE CREATURE + COMBAT CATALOG, from the backend (`GET /api/combat`).
 *
 * Alexander, 2026-09-10: *"any data that changes per level, per template, list of available templates,
 * their footprints, basically anything that is DATA should be moved to the backend, the frontend just
 * processes the data algorithmically"*.
 *
 * What came over: the nine enemy archetypes (`game/archetypes.ts`'s `ENEMY_ARCHETYPES`), the tunable
 * coefficients the damage maths multiplies by (`game/combat.ts`), and the default stat lines
 * (`game/entities.ts`). What did NOT: the formulas. `(weapon.baseDamage + strength) * multiplier` is the
 * shape of the algorithm, and the frontend is what runs it.
 *
 * ## Two rules this file exists to keep
 *
 * 1. **Nothing is invented.** An unloaded catalog is EMPTY, exactly like an unreachable tileset means no
 *    tiles. A caller that needs a number it was not given does nothing and says so, rather than falling
 *    back to a value this file made up — a hardcoded fallback for backend data is the violation the
 *    migration exists to remove.
 * 2. **Never read at module scope.** `ENEMY_ARCHETYPES` was a module-level `const` built the moment its
 *    file was imported, which is exactly how the brute once captured an empty ability registry and
 *    shipped an 8-damage tap instead of its 18 (the note still stands in `archetypes.ts`). Every reader
 *    here is a FUNCTION, called when something renders or runs.
 */
import { NEBULITH_API } from '@/lib/nebulithApi'
import type { AttackPattern, Stats } from './types'


/** One archetype as `/api/combat` serves it. */
export interface ApiArchetype {
  key: string
  name: string
  stats: Record<string, number>
  moveDelayMs: number
  reachCells: number
  attack: AttackPattern
  position: number
}

/** Which resource a SPECIAL of a school spends, and how it fails when short. */
export interface ResourceRule {
  key: 'rage' | 'mana'
  failure: string
}

/** The coefficients the damage maths multiplies by. Every one of them authored, none derived here. */
export interface CombatRules {
  regularMultiplier: number
  specialMultiplier: number
  ragePerStrength: number
  manaPerIntelligence: number
  specialResourceCost: number
  minDamage: number
  specialResource: Record<string, ResourceRule>
}

/** The stat lines a fresh player / enemy / npc starts from, and how long a death lasts. */
export interface StatRules {
  player: Stats
  enemy: Stats
  npc: Stats
  respawnMs: number
}

let ARCHETYPES: readonly ApiArchetype[] = []
let COMBAT: CombatRules | null = null
let STATS: StatRules | null = null

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** A row is kept only if it carries the fields every reader needs. A half-row is DROPPED, loudly. */
function toArchetype(row: unknown): ApiArchetype | null {
  if (!isObject(row)) return null
  const { key, name, stats, moveDelayMs, reachCells, attack, position } = row
  if (typeof key !== 'string' || key === '' || typeof name !== 'string') {
    console.warn('[combat] a served archetype has no key or name and was dropped', row)
    return null
  }
  if (typeof moveDelayMs !== 'number' || typeof reachCells !== 'number') {
    console.warn(`[combat] archetype "${key}" is missing its pace or reach and was dropped`, row)
    return null
  }
  return {
    key,
    name,
    stats: isObject(stats) ? (stats as Record<string, number>) : {},
    moveDelayMs,
    reachCells,
    attack: (attack ?? { mode: 'sequential', attacks: [] }) as AttackPattern,
    position: typeof position === 'number' ? position : 0,
  }
}

/** Install a served payload. Exported so tests and the loader share one way in. */
export function installCombatCatalog(body: unknown): void {
  const data = isObject(body) && isObject(body.data) ? body.data : undefined
  const rows = Array.isArray(data?.archetypes) ? data.archetypes : []
  ARCHETYPES = rows.map(toArchetype).filter((a): a is ApiArchetype => a !== null)

  const rules = isObject(data?.rules) ? data.rules : {}
  COMBAT = isObject(rules.combat) ? (rules.combat as unknown as CombatRules) : null
  STATS = isObject(rules.stats) ? (rules.stats as unknown as StatRules) : null
}

/** Fetch and install. Failure leaves the catalog EMPTY and says why; it never plants a default roster. */
export async function loadCombatCatalog(): Promise<void> {
  try {
    const res = await fetch(`${NEBULITH_API}/combat`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    installCombatCatalog(await res.json())
  } catch (error) {
    console.warn('[combat] the creature + combat catalog could not be loaded — nothing will fight', error)
  }
}

/** Every archetype the backend serves, in menu order. Empty until it answers. */
export function enemyArchetypes(): readonly ApiArchetype[] {
  return ARCHETYPES
}

/** One archetype by key, or undefined when the backend serves no such creature. */
export function enemyArchetype(key: string | undefined): ApiArchetype | undefined {
  return key === undefined ? undefined : ARCHETYPES.find(a => a.key === key)
}

/** The archetype keys, in menu order — for pickers and rosters. */
export function enemyArchetypeIds(): readonly string[] {
  return ARCHETYPES.map(a => a.key)
}

/** The combat coefficients, or null when the backend has not answered. */
export function combatRules(): CombatRules | null {
  return COMBAT
}

/** The default stat lines, or null when the backend has not answered. */
export function statRules(): StatRules | null {
  return STATS
}
