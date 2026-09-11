/**
 * A CREATURE'S NUMBERS LIVE ON ITS TILE.
 *
 * Alexander, 2026-09-10: *"an enemy is just a regular unit, but marked as hostile towards player. so, I
 * don't think we need a separate table for it, maybe I'm missing something, please explain your reasoning"*.
 *
 * The reasoning did not hold. There were nine archetypes for eight creatures — one each — plus a frontend
 * map translating creature → archetype. Reuse was the only argument for a second table and there was none.
 * A creature's stat block rides on its own tile now and arrives with the tileset.
 */
import { setStyleTile } from '@/engine/tileset/styleTiles'
import { enemyCombat, installCombatCatalog, combatRules, statRules } from '@/game/combatCatalog'

const GOBLIN = {
  stats: { strength: 6, intelligence: 0, defense: 3, maxHp: 34, dodge: 5 },
  moveDelayMs: 1000,
  reachCells: 1,
  attack: { mode: 'sequential', attacks: [{ mode: 'melee', damage: 4, cooldownMs: 1000, name: 'Strike' }] },
}

describe('a creature reads its own tile', () => {
  beforeEach(() => {
    setStyleTile('ascii', 'goblin', { char: 'g', walkable: true, settings: { unitRole: 'enemy', combat: GOBLIN } } as never)
    setStyleTile('ascii', 'flower', { char: '*', walkable: true } as never)
  })

  it('gives a creature the stat block its tile carries', () => {
    expect(enemyCombat('goblin')).toEqual(GOBLIN)
  })

  it('gives a tile with no combat settings nothing, rather than inventing a fighter', () => {
    expect(enemyCombat('flower')).toBeUndefined()
  })

  it('answers undefined for a label the catalog does not carry at all', () => {
    expect(enemyCombat('not-a-tile')).toBeUndefined()
    expect(enemyCombat(undefined)).toBeUndefined()
  })
})

describe('the fightrules, which belong to nobody in particular', () => {
  it('are empty until the backend answers — nothing is invented', () => {
    installCombatCatalog({ data: { rules: {} } })
    expect(combatRules()).toBeNull()
    expect(statRules()).toBeNull()
  })

  it('carry the coefficients the damage maths multiplies by', () => {
    installCombatCatalog({
      data: { rules: { combat: { regularMultiplier: 1, specialMultiplier: 1.75, minDamage: 1 } } },
    })
    expect(combatRules()?.specialMultiplier).toBe(1.75)
  })

  it('carry the default stat lines and the respawn delay', () => {
    installCombatCatalog({ data: { rules: { stats: { player: { maxHp: 100 }, respawnMs: 5000 } } } })
    expect(statRules()?.player.maxHp).toBe(100)
    expect(statRules()?.respawnMs).toBe(5000)
  })

  it('survives a payload with no data at all', () => {
    installCombatCatalog({})
    expect(combatRules()).toBeNull()
  })
})
