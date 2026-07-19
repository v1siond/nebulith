/**
 * Tile Animation ENGINE — pure interpolator unit tests (Phase 1).
 *
 * Exercises the clock-derived value engine directly (no canvas): opacity 0→1 over a duration, a vertical
 * `y` rise, start-delay deferral, loop wrapping, loop-delay rest, colour RGB lerp, display step, ease
 * curves, priority/list-order stacking, scope gating, and the sprite stub. The headline case is TWO chained
 * animations (A rise + B delayed fade) composed through `resolveAnimatedSettings`, sampled across time.
 */

import {
  animationValue,
  resolveAnimatedSettings,
  animationMatchesScope,
  spriteFrameIndex,
  easeAnim,
  flickerEase,
  type SettingsAnimation,
  type SpriteAnimation,
} from '@/engine/animation/tileAnimation'

/** Build a settings animation from partial fields (id/kind/duration/tracks always present). */
function settingsAnim(over: Partial<SettingsAnimation> & Pick<SettingsAnimation, 'tracks'>): SettingsAnimation {
  return {
    id: over.id ?? 'anim',
    kind: 'settings',
    durationMs: over.durationMs ?? 1000,
    tracks: over.tracks,
    ...over,
  }
}

describe('animationValue — a single settings animation', () => {
  test('opacity 0→1 tweens linearly across the duration, then HOLDS at 1 (non-loop)', () => {
    const anim = settingsAnim({ tracks: [{ setting: 'opacity', from: 0, to: 1 }], durationMs: 1000 })
    expect(animationValue(anim, 0, 0).opacity).toBe(0) // start = from
    expect(animationValue(anim, 250, 0).opacity).toBeCloseTo(0.25)
    expect(animationValue(anim, 500, 0).opacity).toBeCloseTo(0.5)
    expect(animationValue(anim, 1000, 0).opacity).toBeCloseTo(1) // end = to
    expect(animationValue(anim, 5000, 0).opacity).toBe(1) // past the end holds `to`
  })

  test('a vertical y RISE (10 → 0) reads the tweened offset at each sample', () => {
    const anim = settingsAnim({ tracks: [{ setting: 'y', from: 10, to: 0 }], durationMs: 1000 })
    expect(animationValue(anim, 0, 0).y).toBe(10)
    expect(animationValue(anim, 250, 0).y).toBeCloseTo(7.5)
    expect(animationValue(anim, 1000, 0).y).toBeCloseTo(0)
  })

  test('startDelayMs DEFERS the tween — the value stays at `from` until the delay elapses', () => {
    const anim = settingsAnim({
      tracks: [{ setting: 'opacity', from: 0, to: 1 }],
      durationMs: 1000,
      startDelayMs: 300,
    })
    expect(animationValue(anim, 0, 0).opacity).toBe(0) // deferred
    expect(animationValue(anim, 200, 0).opacity).toBe(0) // still inside the delay
    expect(animationValue(anim, 300, 0).opacity).toBe(0) // exactly at the delay → begins
    expect(animationValue(anim, 800, 0).opacity).toBeCloseTo(0.5) // (800-300)/1000
  })

  test('the placedAt anchor shifts the whole timeline', () => {
    const anim = settingsAnim({ tracks: [{ setting: 'opacity', from: 0, to: 1 }], durationMs: 1000 })
    // placed at t=5000 → half done at t=5500, done at t=6000.
    expect(animationValue(anim, 5000, 5000).opacity).toBe(0)
    expect(animationValue(anim, 5500, 5000).opacity).toBeCloseTo(0.5)
    expect(animationValue(anim, 6000, 5000).opacity).toBeCloseTo(1)
    expect(animationValue(anim, 4000, 5000).opacity).toBe(0) // before it is placed → from
  })

  test('loop WRAPS on the duration (no loop delay)', () => {
    const anim = settingsAnim({
      tracks: [{ setting: 'opacity', from: 0, to: 1 }],
      durationMs: 1000,
      loop: true,
    })
    expect(animationValue(anim, 1000, 0).opacity).toBe(0) // wrapped back to from
    expect(animationValue(anim, 1500, 0).opacity).toBeCloseTo(0.5) // second cycle midpoint
    expect(animationValue(anim, 2250, 0).opacity).toBeCloseTo(0.25) // third cycle quarter
  })

  test('loopDelayMs RESTS at the end value between loops, then snaps back to `from`', () => {
    const anim = settingsAnim({
      tracks: [{ setting: 'opacity', from: 0, to: 1 }],
      durationMs: 1000,
      loopDelayMs: 500,
      loop: true,
    })
    // period = 1500: [0,1000) tween, [1000,1500) rest at 1, then wrap.
    expect(animationValue(anim, 1000, 0).opacity).toBe(1) // rest begins, holds `to`
    expect(animationValue(anim, 1200, 0).opacity).toBe(1) // still resting
    expect(animationValue(anim, 1499, 0).opacity).toBe(1) // rest end
    expect(animationValue(anim, 1500, 0).opacity).toBe(0) // new cycle → back to from
    expect(animationValue(anim, 1750, 0).opacity).toBeCloseTo(0.25)
  })

  test('yoyo (ping-pong) grows from→to then auto-reverses to→from within one period, resting at `from`', () => {
    // The fountain water column: height 1→4 over 1000ms (up leg), auto-reverse 4→1 over the next 1000ms
    // (down leg), then a 400ms loopDelay tail rests at the base (1). Period = 2·1000 + 400 = 2400ms.
    const anim = settingsAnim({
      tracks: [{ setting: 'height', from: 1, to: 4 }],
      durationMs: 1000,
      loopDelayMs: 400,
      loop: true,
      yoyo: true,
    })
    const h = (t: number) => animationValue(anim, t, 0).height as number
    // UP leg 0→1000ms: 1 → 4 (linear, no ease here)
    expect(h(0)).toBeCloseTo(1) // base
    expect(h(500)).toBeCloseTo(2.5) // halfway up
    expect(h(1000)).toBeCloseTo(4) // peak (top of the arc)
    // DOWN leg 1000→2000ms: 4 → 1 (auto-reversed, continuous at the peak)
    expect(h(1500)).toBeCloseTo(2.5) // halfway back down
    expect(h(2000)).toBeCloseTo(1) // returned to base
    // loopDelay tail 2000→2400ms: RESTS at the base (from), not the peak
    expect(h(2200)).toBeCloseTo(1)
    expect(h(2399)).toBeCloseTo(1)
    // next cycle wraps: 2400 == a fresh base, 2900 == halfway up again
    expect(h(2400)).toBeCloseTo(1)
    expect(h(2900)).toBeCloseTo(2.5)
    // it NEVER exceeds the peak or drops below the base (a bounded oscillation)
    for (let t = 0; t <= 2400; t += 50) {
      expect(h(t)).toBeGreaterThanOrEqual(1 - 1e-9)
      expect(h(t)).toBeLessThanOrEqual(4 + 1e-9)
    }
  })

  test('yoyo with no loopDelay is a seamless continuous up/down oscillation', () => {
    const anim = settingsAnim({
      tracks: [{ setting: 'height', from: 1, to: 4 }],
      durationMs: 1000,
      loop: true,
      yoyo: true,
    })
    const h = (t: number) => animationValue(anim, t, 0).height as number
    expect(h(1000)).toBeCloseTo(4) // peak
    expect(h(2000)).toBeCloseTo(1) // back to base
    expect(h(3000)).toBeCloseTo(4) // peak again (period = 2000ms)
  })
})

describe('animationValue — colour, display, ease', () => {
  test('color tween is an RGB lerp emitting rgb(r, g, b)', () => {
    const anim = settingsAnim({
      tracks: [{ setting: 'color', from: '#000000', to: '#ffffff' }],
      durationMs: 1000,
    })
    expect(animationValue(anim, 0, 0).color).toBe('rgb(0, 0, 0)')
    expect(animationValue(anim, 500, 0).color).toBe('rgb(128, 128, 128)')
    expect(animationValue(anim, 1000, 0).color).toBe('rgb(255, 255, 255)')
  })

  test('color lerp interpolates each channel independently', () => {
    const anim = settingsAnim({
      tracks: [{ setting: 'color', from: '#ff0000', to: '#0000ff' }],
      durationMs: 1000,
    })
    expect(animationValue(anim, 500, 0).color).toBe('rgb(128, 0, 128)')
  })

  test('display STEPS at the temporal midpoint (no tween)', () => {
    const anim = settingsAnim({
      tracks: [{ setting: 'display', from: 'block', to: 'none' }],
      durationMs: 1000,
    })
    expect(animationValue(anim, 0, 0).display).toBe('block')
    expect(animationValue(anim, 400, 0).display).toBe('block') // before midpoint
    expect(animationValue(anim, 500, 0).display).toBe('none') // at/after midpoint
    expect(animationValue(anim, 900, 0).display).toBe('none')
  })

  test('sine ease is symmetric with a 0.5 midpoint and eases the ends', () => {
    const anim = settingsAnim({
      tracks: [{ setting: 'opacity', from: 0, to: 1 }],
      durationMs: 1000,
      ease: 'sine',
    })
    expect(animationValue(anim, 500, 0).opacity).toBeCloseTo(0.5) // symmetric midpoint
    expect(animationValue(anim, 250, 0).opacity).toBeCloseTo(easeAnim('sine', 0.25))
    expect(animationValue(anim, 250, 0).opacity as number).toBeLessThan(0.25) // eased-in slower than linear
  })
})

describe('resolveAnimatedSettings — composing a LIST', () => {
  test('two chained animations (A y-rise + B delayed opacity-fade) stack to the expected values over time', () => {
    const riseY = settingsAnim({
      id: 'A-rise',
      tracks: [{ setting: 'y', from: 10, to: 0 }],
      durationMs: 1000,
    })
    const fade = settingsAnim({
      id: 'B-fade',
      tracks: [{ setting: 'opacity', from: 1, to: 0 }],
      durationMs: 1000,
      startDelayMs: 1000, // starts as A finishes → a chain
    })
    const chain = [riseY, fade]

    // t=0: A at start (y=10), B deferred (opacity=1, its `from`).
    expect(resolveAnimatedSettings(chain, 0, 0)).toEqual({ y: 10, opacity: 1 })
    // t=500: A halfway up (y=5), B still deferred (opacity=1).
    expect(resolveAnimatedSettings(chain, 500, 0)).toEqual({ y: 5, opacity: 1 })
    // t=1000: A done (y=0, held), B just begins (opacity=1).
    expect(resolveAnimatedSettings(chain, 1000, 0)).toEqual({ y: 0, opacity: 1 })
    // t=1500: A held at 0, B halfway faded (opacity=0.5).
    const mid = resolveAnimatedSettings(chain, 1500, 0)
    expect(mid.y).toBeCloseTo(0)
    expect(mid.opacity).toBeCloseTo(0.5)
    // t=2000: A held at 0, B fully faded (opacity=0).
    const end = resolveAnimatedSettings(chain, 2000, 0)
    expect(end.y).toBeCloseTo(0)
    expect(end.opacity).toBeCloseTo(0)
  })

  test('higher priority wins when two animations write the same setting', () => {
    const low = settingsAnim({ id: 'low', tracks: [{ setting: 'opacity', from: 0.2, to: 0.2 }], priority: 0 })
    const high = settingsAnim({ id: 'high', tracks: [{ setting: 'opacity', from: 0.9, to: 0.9 }], priority: 5 })
    // Order puts `high` FIRST to prove priority — not order — decides.
    expect(resolveAnimatedSettings([high, low], 500, 0).opacity).toBe(0.9)
    expect(resolveAnimatedSettings([low, high], 500, 0).opacity).toBe(0.9)
  })

  test('on a priority tie, the animation LATER in the list wins', () => {
    const first = settingsAnim({ id: 'first', tracks: [{ setting: 'opacity', from: 0.3, to: 0.3 }] })
    const second = settingsAnim({ id: 'second', tracks: [{ setting: 'opacity', from: 0.7, to: 0.7 }] })
    expect(resolveAnimatedSettings([first, second], 500, 0).opacity).toBe(0.7)
    expect(resolveAnimatedSettings([second, first], 500, 0).opacity).toBe(0.3)
  })

  test('non-overlapping settings simply stack; sprite animations contribute nothing', () => {
    const move = settingsAnim({ id: 'm', tracks: [{ setting: 'x', from: 0, to: 4 }], durationMs: 1000 })
    const sprite: SpriteAnimation = {
      id: 's',
      kind: 'sprite',
      durationMs: 1000,
      frames: ['water_0', 'water_1'],
    }
    const out = resolveAnimatedSettings([move, sprite], 500, 0)
    expect(out).toEqual({ x: 2 }) // sprite adds no setting keys
  })

  test('an empty list yields no overrides', () => {
    expect(resolveAnimatedSettings([], 500, 0)).toEqual({})
  })
})

describe('scope + sprite stub', () => {
  test('scope gates by view and style; absent/empty lists mean all', () => {
    const isoOnly = settingsAnim({ tracks: [{ setting: 'opacity', from: 0, to: 1 }], scope: { views: ['iso'] } })
    expect(animationMatchesScope(isoOnly, 'emoji', 'iso')).toBe(true)
    expect(animationMatchesScope(isoOnly, 'emoji', '2d')).toBe(false)

    const asciiOnly = settingsAnim({ tracks: [{ setting: 'opacity', from: 0, to: 1 }], scope: { styles: ['ascii'] } })
    expect(animationMatchesScope(asciiOnly, 'ascii', 'top')).toBe(true)
    expect(animationMatchesScope(asciiOnly, 'emoji', 'top')).toBe(false)

    const unscoped = settingsAnim({ tracks: [{ setting: 'opacity', from: 0, to: 1 }] })
    expect(animationMatchesScope(unscoped, 'emoji', 'top')).toBe(true)
  })

  test('a sprite animation yields no settings and stubs to frame 0', () => {
    const sprite: SpriteAnimation = { id: 's', kind: 'sprite', durationMs: 1000, frames: ['a', 'b', 'c'] }
    expect(animationValue(sprite, 500, 0)).toEqual({})
    expect(spriteFrameIndex(sprite, 500, 0)).toBe(0)
  })
})

// The FAILING-bulb envelope (Alexander: "more irregular … a failing bulb"). Sampled across the phase [0,1),
// it must be a MINORITY of dips over a mostly-ON baseline, STEPPED (abrupt jumps — never a smooth sine), and
// deterministic. easeAnim routes `ease:'flicker'` to it, so an opacity flicker animation reads erratic, not sine.
describe('flickerEase — the irregular, stepped failing-bulb envelope (NOT a sine yoyo)', () => {
  const N = 400
  const samples = Array.from({ length: N }, (_, i) => flickerEase(i / N))

  test('deterministic + bounded to [0,1]', () => {
    expect(flickerEase(0.37)).toBe(flickerEase(0.37))
    for (const v of samples) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })

  test('mostly ON: the MAJORITY of the loop is fully lit (envelope 0) — the dips are the minority', () => {
    const lit = samples.filter(v => v === 0).length
    expect(lit / N).toBeGreaterThan(0.5) // a normal-looking lamp that occasionally faults, not a strobe
  })

  test('STEPPED, not smooth: adjacent samples take a large JUMP somewhere (a sine yoyo never does)', () => {
    let maxStep = 0
    for (let i = 1; i < samples.length; i++) maxStep = Math.max(maxStep, Math.abs(samples[i] - samples[i - 1]))
    expect(maxStep).toBeGreaterThanOrEqual(0.4) // an abrupt on↔off edge — the failing-bulb signature
    // contrast: a sine ease over the same fine sampling is smooth — every adjacent step is tiny
    let sineMax = 0
    for (let i = 1; i < N; i++) sineMax = Math.max(sineMax, Math.abs(easeAnim('sine', i / N) - easeAnim('sine', (i - 1) / N)))
    expect(sineMax).toBeLessThan(0.05)
  })

  test('IRREGULAR amplitude: the dips are NOT all the same depth (varying fault severity)', () => {
    const dips = new Set(samples.filter(v => v > 0).map(v => v.toFixed(3)))
    expect(dips.size).toBeGreaterThanOrEqual(2) // multiple distinct dip depths → erratic, not one uniform pulse
  })

  test('easeAnim routes `flicker` to flickerEase, and an opacity flicker reads erratic (not a sine tween)', () => {
    expect(easeAnim('flicker', 0.42)).toBe(flickerEase(0.42))
    // an opacity 1→0.12 flicker animation, sampled over its loop, is mostly 1 (on) with abrupt dips — not a curve
    const flick = settingsAnim({ durationMs: 2600, loop: true, ease: 'flicker', tracks: [{ setting: 'opacity', from: 1, to: 0.12 }] })
    const op = Array.from({ length: 130 }, (_, i) => Number(animationValue(flick, i * 20, 0).opacity))
    expect(op.filter(v => v > 0.99).length / op.length).toBeGreaterThan(0.5) // mostly fully-on
    let maxStep = 0
    for (let i = 1; i < op.length; i++) maxStep = Math.max(maxStep, Math.abs(op[i] - op[i - 1]))
    expect(maxStep).toBeGreaterThan(0.3) // abrupt opacity dips — a failing bulb, not a smooth breathe
  })
})
