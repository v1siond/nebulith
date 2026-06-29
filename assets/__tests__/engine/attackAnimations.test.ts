import {
  weaponAnimKind,
  animProgress,
  isAnimDone,
  animFrame,
  ATTACK_ANIM_MS,
  type AttackAnim,
} from '@/engine/attackAnimations'

const anim = (over: Partial<AttackAnim> = {}): AttackAnim => ({
  kind: 'slash',
  fromX: 0, fromZ: 0,
  toX: 100, toZ: 0,
  start: 1000,
  durationMs: 300,
  ...over,
})

describe('attackAnimations — weapon → animation kind', () => {
  it('maps melee weapons to a slash, ranged to a shot, staff to lightning', () => {
    expect(weaponAnimKind('sword', 'melee')).toBe('slash')
    expect(weaponAnimKind('axe', 'melee')).toBe('slash')
    expect(weaponAnimKind('bow', 'ranged')).toBe('shot')
    expect(weaponAnimKind('gun', 'ranged')).toBe('shot')
    expect(weaponAnimKind('staff', 'melee')).toBe('lightning')
  })
  it('any ranged weapon shoots regardless of kind', () => {
    expect(weaponAnimKind('sword', 'ranged')).toBe('shot')
  })
})

describe('attackAnimations — progress + lifetime', () => {
  it('clamps progress to 0..1 across the duration', () => {
    const a = anim({ start: 1000, durationMs: 300 })
    expect(animProgress(a, 1000)).toBeCloseTo(0)
    expect(animProgress(a, 1150)).toBeCloseTo(0.5)
    expect(animProgress(a, 5000)).toBe(1) // clamped
  })
  it('is done once the duration elapses', () => {
    const a = anim({ start: 1000, durationMs: 300 })
    expect(isAnimDone(a, 1200)).toBe(false)
    expect(isAnimDone(a, 1300)).toBe(true)
  })
})

describe('attackAnimations — frames', () => {
  it('returns a glyph + color while live, null once done', () => {
    const a = anim({ kind: 'slash', start: 1000, durationMs: 300 })
    const f = animFrame(a, 1100)
    expect(f).not.toBeNull()
    expect(typeof f!.char).toBe('string')
    expect(f!.char.length).toBeGreaterThan(0)
    expect(f!.color).toMatch(/^#/)
    expect(animFrame(a, 1300)).toBeNull()
  })
  it('a shot travels from→to; a slash swings in the attacker hand reaching toward the target', () => {
    const shot = anim({ kind: 'shot', fromX: 0, toX: 100, fromZ: 0, toZ: 0, start: 0, durationMs: 100 })
    expect(animFrame(shot, 0)!.x).toBeCloseTo(0)
    expect(animFrame(shot, 50)!.x).toBeCloseTo(50)
    // A slash stays near the attacker (fromX) — only a small reach toward the target, NOT pinned
    // on the enemy cell (that was the "stick floating 1 cell away" bug).
    const slash = anim({ kind: 'slash', fromX: 0, toX: 100, start: 0, durationMs: 100 })
    const sx = animFrame(slash, 50)!.x
    expect(sx).toBeGreaterThan(0)
    expect(sx).toBeLessThan(50) // closer to the attacker than to the target
    // Magic/block still land on the target cell.
    const bolt = anim({ kind: 'lightning', fromX: 0, toX: 100, start: 0, durationMs: 100 })
    expect(animFrame(bolt, 50)!.x).toBeCloseTo(100)
  })
  it('advances through its frame sequence over time', () => {
    const a = anim({ kind: 'lightning', start: 0, durationMs: 100 })
    const first = animFrame(a, 0)!.char
    const last = animFrame(a, 99)!.char
    expect(first).not.toBe(last) // different frames at the ends
  })
})

describe('attackAnimations — durations table', () => {
  it('defines a positive duration for every kind', () => {
    for (const k of ['slash', 'shot', 'lightning', 'block'] as const) {
      expect(ATTACK_ANIM_MS[k]).toBeGreaterThan(0)
    }
  })
})
