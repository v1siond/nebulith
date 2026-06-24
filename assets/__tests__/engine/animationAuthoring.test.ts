import { makeCycle, validateCycle, describeCycle, makeTrigger, CYCLE_MODES } from '@/engine/animationAuthoring'
import type { AnimationCycle } from '@/engine/animationCycles'

const known = new Set(['flower-sway', 'lamp-flicker'])

describe('animationAuthoring — pure helpers behind the author panel', () => {
  it('exposes the three cycle modes', () => {
    expect(CYCLE_MODES).toEqual(['sequential', 'randomized', 'stacked'])
  })

  it('makeCycle clamps + rounds delay and copies the animation list', () => {
    const anims = ['flower-sway']
    const c = makeCycle('c1', anims, 'sequential', -50.7, { kind: 'always' })
    expect(c.delayMs).toBe(0) // clamped to ≥ 0
    expect(c.animations).toEqual(['flower-sway'])
    expect(c.animations).not.toBe(anims) // copied, not aliased
    expect(makeCycle('c2', anims, 'stacked', 123.6, { kind: 'state', state: 'combat' }).delayMs).toBe(124)
  })

  it('validateCycle rejects empty + unknown animations, accepts a good cycle', () => {
    const empty: AnimationCycle = { id: 'e', animations: [], mode: 'sequential', delayMs: 0, trigger: { kind: 'always' } }
    expect(validateCycle(empty, known).ok).toBe(false)

    const bad = makeCycle('b', ['nope'], 'sequential', 0, { kind: 'always' })
    const badRes = validateCycle(bad, known)
    expect(badRes.ok).toBe(false)
    expect(badRes.reason).toContain('nope')

    const good = makeCycle('g', ['flower-sway', 'lamp-flicker'], 'stacked', 200, { kind: 'state', state: 'combat' })
    expect(validateCycle(good, known)).toEqual({ ok: true })
  })

  it('makeTrigger builds always / state triggers, defaulting a blank state to combat', () => {
    expect(makeTrigger('always')).toEqual({ kind: 'always' })
    expect(makeTrigger('state', 'walk')).toEqual({ kind: 'state', state: 'walk' })
    expect(makeTrigger('state', '  ')).toEqual({ kind: 'state', state: 'combat' }) // blank → default
  })

  it('describeCycle summarizes mode / count / delay / trigger', () => {
    const c = makeCycle('c', ['flower-sway', 'lamp-flicker'], 'stacked', 0, { kind: 'state', state: 'combat' })
    expect(describeCycle(c)).toBe('stacked · 2 anim · 0ms gap · on combat')
    const always = makeCycle('c', ['flower-sway'], 'sequential', 300, { kind: 'always' })
    expect(describeCycle(always)).toBe('sequential · 1 anim · 300ms gap · always')
  })
})
