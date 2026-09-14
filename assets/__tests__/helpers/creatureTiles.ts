/**
 * Install the creature tiles a combat test needs.
 *
 * A creature's stat block lives on its TILE now (`settings.combat`), resolved from the enemy type through
 * `/api/entities` — A test that builds an enemy therefore has to install the tile, exactly as the app installs the
 * tileset before anything fights.
 *
 * The numbers mirror the seeder (`TileSource.seed_unit_combat/0`) so a test asserts what ships.
 */
import { setStyleTile } from '@/engine/tileset/styleTiles'
import { setEntityResolution } from '@/engine/entity/entityResolution'

type Attack = { mode: string; damage: number; cooldownMs: number; animation?: string; name?: string; reachCells?: number }

const creature = (
  stats: Record<string, number>,
  moveDelayMs: number,
  reachCells: number,
  attacks: Attack[],
) => ({ stats, moveDelayMs, reachCells, attack: { mode: 'sequential', attacks } })

/** slug → its combat block, as the backend seeds it. */
export const CREATURE_COMBAT = {
  goblin: creature({ strength: 6, intelligence: 0, defense: 3, maxHp: 34, dodge: 5 }, 1000, 1,
    [{ mode: 'melee', damage: 4, cooldownMs: 1000, animation: 'cleave', name: 'Strike' }]),
  skeleton: creature({ strength: 12, intelligence: 0, defense: 6, maxHp: 72, dodge: 0 }, 1700, 1,
    [{ mode: 'melee', damage: 18, cooldownMs: 6000, animation: 'fire-slash', name: 'Fire Slash' }]),
  wolf: creature({ strength: 5, intelligence: 0, defense: 1, maxHp: 20, dodge: 18 }, 550, 1,
    [{ mode: 'melee', damage: 2, cooldownMs: 450, animation: 'cleave', name: 'Quick Slash' }]),
  ninja: creature({ strength: 4, intelligence: 0, defense: 1, maxHp: 22, dodge: 10 }, 900, 6,
    [{ mode: 'ranged', damage: 6, cooldownMs: 1500, animation: 'bolt', name: 'Bolt', reachCells: 6 }]),
  ghost: creature({ strength: 3, intelligence: 10, defense: 1, maxHp: 18, dodge: 6 }, 950, 7,
    [{ mode: 'ranged', damage: 12, cooldownMs: 1900, animation: 'nova', name: 'Arcane Bolt', reachCells: 7 }]),
  bat: creature({ strength: 4, intelligence: 0, defense: 0, maxHp: 16, dodge: 24 }, 560, 1,
    [{ mode: 'melee', damage: 2, cooldownMs: 500, animation: 'cleave', name: 'Bite' }]),
  spider: creature({ strength: 6, intelligence: 0, defense: 2, maxHp: 30, dodge: 12 }, 720, 1,
    [{ mode: 'melee', damage: 4, cooldownMs: 900, animation: 'cleave', name: 'Venom Bite' }]),
  guardian: creature({ strength: 14, intelligence: 0, defense: 9, maxHp: 96, dodge: 0 }, 1700, 1,
    [{ mode: 'melee', damage: 20, cooldownMs: 2200, animation: 'cleave', name: 'Crush' }]),
} as const

/** enemy type → the slug it draws as, mirroring `EntitySource.enemy_type_slug`. */
const TYPE_SLUG: Record<string, string> = {
  goblin: 'goblin', wolf: 'wolf', bandit: 'ninja', skeleton: 'skeleton',
  bat: 'bat', spider: 'spider', guardian: 'guardian', wraith: 'ghost',
}

/** Install every creature tile + the type→slug resolution, so `combatForEnemyType` can answer. */
export function installCreatureTiles(): void {
  for (const [slug, combat] of Object.entries(CREATURE_COMBAT)) {
    setStyleTile('ascii', slug, { char: slug[0], walkable: true, settings: { unitRole: 'enemy', combat } } as never)
  }
  setEntityResolution({ dir: '', tiles: {}, enemyTypeSlug: TYPE_SLUG, variantSlug: {} })
}
