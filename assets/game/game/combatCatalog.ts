/**
 * THE CREATURE + COMBAT CATALOG, from the backend (`GET /api/combat`).
 *
 * What came over: the tunable coefficients the damage maths multiplies by (`game/combat.ts`) and the
 * default stat lines (`game/entities.ts`). What did NOT: the formulas. `(weapon.baseDamage + strength) *
 * multiplier` is the shape of the algorithm, and the frontend is what runs it.
 *
 * A CREATURE's numbers are not here either. That was right: the
 * archetype table held nine entries for eight creatures, one each, with a frontend map translating between
 * the two vocabularies. A creature's stat block now rides on its own TILE (`settings.combat`) and arrives
 * with the tileset, so `enemyCombat()` reads it from there.
 *
 * ## Two rules this file exists to keep
 *
 * 1. **Nothing is invented.** An unloaded catalog is EMPTY, exactly like an unreachable tileset means no
 *    tiles. A caller that needs a number it was not given does nothing and says so, rather than falling
 *    back to a value this file made up, a hardcoded fallback for backend data is the violation the
 *    migration exists to remove.
 * 2. **Never read at module scope.** `ENEMY_ARCHETYPES` was a module-level `const` built the moment its
 *    file was imported, which is exactly how the brute once captured an empty ability registry and
 *    shipped an 8-damage tap instead of its 18 (the note still stands in `archetypes.ts`). Every reader
 *    here is a FUNCTION, called when something renders or runs.
 */
import { NEBULITH_API } from '@/lib/nebulithApi'
import { getEntityResolution } from '@/engine/entity/entityResolution'
import { installZoneRules } from '@/engine/zoneCatalog'
import { styleTile } from '@/engine/tileset/styleTiles'
import type { AttackPattern, Stats } from './types'

/** What a creature fights with, as its tile row carries it. */
export interface CreatureCombat {
  stats: Record<string, number>
  moveDelayMs: number
  reachCells: number
  attack: AttackPattern
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

let COMBAT: CombatRules | null = null
let STATS: StatRules | null = null

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Install a served payload. Exported so tests and the loader share one way in. */
export function installCombatCatalog(body: unknown): void {
  const data = isObject(body) && isObject(body.data) ? body.data : undefined
  const rules = isObject(data?.rules) ? data.rules : {}
  COMBAT = isObject(rules.combat) ? (rules.combat as unknown as CombatRules) : null
  STATS = isObject(rules.stats) ? (rules.stats as unknown as StatRules) : null
}

/** Fetch and install. Failure leaves the catalog EMPTY and says why; it never plants a default roster. */
export async function loadCombatCatalog(): Promise<void> {
  try {
    const res = await fetch(`${NEBULITH_API}/combat`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    installCombatCatalog(body)
    // The season-INDEPENDENT tables (tree weights, rock shades, cave decor, prop art) ride in the same
    // bundles, because they are rules rather than anything one season owns. One fetch, both readers.
    installZoneRules((body as { data?: { rules?: unknown } })?.data?.rules)
  } catch (error) {
    console.warn('[combat] the creature + combat catalog could not be loaded, nothing will fight', error)
  }
}

/**
 * The stat block a creature fights with, read off its own TILE.
 *
 * A creature IS a unit tile, so its numbers live in that tile's `settings.combat` and arrive with the
 * tileset. Undefined for a tile that carries none, a peaceful animal, a prop, a person, and the caller
 * then places a plain unit rather than inventing a fighter.
 *
 * Structure is style-identical (a style only changes the picture), so this reads the same catalog every
 * other structure reader does.
 */
export function enemyCombat(label: string | undefined): CreatureCombat | undefined {
  if (!label) return undefined
  const settings = styleTile('ascii', label)?.settings as { combat?: unknown } | undefined
  const combat = settings?.combat
  return isObject(combat) ? (combat as unknown as CreatureCombat) : undefined
}

/**
 * The stat block for an enemy TYPE (`bandit`, `wraith`), through the backend's own resolution.
 *
 * A type is not a tile: a bandit draws as the ninja tile and a wraith as the ghost, and that mapping is
 * `/api/entities` data. So this resolves type → slug → the tile's combat, and every hop is backend-owned.
 * The frontend's old `ARCHETYPE_BY_ENEMY_TYPE` did the same job with a hardcoded table; it is gone.
 */
export function combatForEnemyType(enemyType: string | undefined): CreatureCombat | undefined {
  if (!enemyType) return undefined
  const slug = getEntityResolution().enemyTypeSlug[enemyType.toLowerCase()]
  return enemyCombat(slug ?? enemyType.toLowerCase())
}

/** The combat coefficients, or null when the backend has not answered. */
export function combatRules(): CombatRules | null {
  return COMBAT
}

/** The default stat lines, or null when the backend has not answered. */
export function statRules(): StatRules | null {
  return STATS
}
