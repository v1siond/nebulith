/**
 * Per-entity SIZE → stats. A bigger figure (a boss) isn't just drawn larger — its stat block scales
 * with size so it's genuinely tougher. These pin the PURE scaling helper (the one tunable knob,
 * SIZE_STAT_EXPONENT) and that makeEnemy applies it after the archetype/overrides and stamps `size`.
 */
import {
  scaleStatsBySize,
  SIZE_STAT_EXPONENT,
  makeEnemy,
  DEFAULT_ENEMY_STATS,
} from '@/game/entities'
import type { Stats } from '@/game/types'

const stats = (over: Partial<Stats> = {}): Stats => ({
  strength: 10,
  intelligence: 4,
  defense: 6,
  maxHp: 50,
  dodge: 8,
  ...over,
})

describe('scaleStatsBySize — bigger entities get beefier stats', () => {
  it('size 1 leaves the block unchanged (and returns a fresh object, never the input)', () => {
    const base = stats()
    const out = scaleStatsBySize(base, 1)
    expect(out).toEqual(base)
    expect(out).not.toBe(base)
  })

  it('a size ≤ 1 never SHRINKS an entity below its base', () => {
    expect(scaleStatsBySize(stats(), 0.5)).toEqual(stats())
    expect(scaleStatsBySize(stats(), 0)).toEqual(stats())
  })

  it('size 2 doubles HP + offensive/defensive stats (linear at the default exponent 1)', () => {
    expect(SIZE_STAT_EXPONENT).toBe(1) // the flagged knob — linear by default
    const out = scaleStatsBySize(stats(), 2)
    expect(out.maxHp).toBe(100)
    expect(out.strength).toBe(20)
    expect(out.intelligence).toBe(8)
    expect(out.defense).toBe(12)
  })

  it('leaves DODGE untouched — a hulking boss should not also be evasive', () => {
    expect(scaleStatsBySize(stats(), 3).dodge).toBe(8)
  })

  it('scales by size^SIZE_STAT_EXPONENT and rounds a fractional result', () => {
    const m = 1.5 ** SIZE_STAT_EXPONENT
    const out = scaleStatsBySize(stats({ maxHp: 55 }), 1.5)
    expect(out.maxHp).toBe(Math.round(55 * m)) // 83 at exponent 1
    expect(out.strength).toBe(Math.round(10 * m)) // 15
  })
})

describe('makeEnemy applies size', () => {
  it('a size-2 enemy stamps `size` and derives doubled base stats', () => {
    const boss = makeEnemy('b1', 0, 0, 'dragon', { size: 2 })
    expect(boss.size).toBe(2)
    expect(boss.baseStats.maxHp).toBe(DEFAULT_ENEMY_STATS.maxHp * 2)
    expect(boss.baseStats.strength).toBe(DEFAULT_ENEMY_STATS.strength * 2)
  })

  it('size multiplies the FINAL block — after the explicit stat overrides', () => {
    const boss = makeEnemy('b2', 0, 0, 'dragon', { stats: { maxHp: 500 }, size: 2 })
    expect(boss.baseStats.maxHp).toBe(1000) // 500 override → ×2 size
  })

  it('a normal enemy (no size) carries no `size` field and keeps base stats', () => {
    const mob = makeEnemy('m1', 0, 0, 'goblin')
    expect(mob.size).toBeUndefined()
    expect(mob.baseStats.maxHp).toBe(DEFAULT_ENEMY_STATS.maxHp)
  })
})
