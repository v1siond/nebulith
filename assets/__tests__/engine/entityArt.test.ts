import { entityArt, ENEMY_ART, ENEMY_ART_TYPES, ENEMY_FALLBACK, NPC_ART } from '@/engine/entityArt'
import { makeEnemy, makeNpc } from '@/game/entities'

describe('entityArt — multi-row ASCII for entities', () => {
  it('every enemy type, the fallback, and npc art is non-empty multi-row', () => {
    expect(ENEMY_ART_TYPES.length).toBeGreaterThan(0)
    for (const t of ENEMY_ART_TYPES) {
      const art = ENEMY_ART[t]
      expect(art.length).toBeGreaterThanOrEqual(2) // multi-row
      expect(art.every(r => r.length > 0)).toBe(true)
    }
    expect(ENEMY_FALLBACK.length).toBeGreaterThanOrEqual(2)
    expect(NPC_ART.length).toBeGreaterThanOrEqual(2)
  })

  it('returns typed art for a known enemy and the fallback for an unknown type', () => {
    expect(entityArt(makeEnemy('e1', 0, 0, 'goblin'))).toBe(ENEMY_ART.goblin)
    expect(entityArt(makeEnemy('e2', 1, 1, 'dragon-xyz'))).toBe(ENEMY_FALLBACK)
  })

  it('npc uses the humanoid figure', () => {
    expect(entityArt(makeNpc('n1', 2, 2, { name: 'Bob' }))).toBe(NPC_ART)
  })
})
