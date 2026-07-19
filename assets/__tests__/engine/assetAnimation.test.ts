/**
 * Unit tests for `resolveAssetAnimation` — the render-side bridge that gates a placed asset's animations by
 * (style, view) scope and composes their live per-frame overrides for the renderer. PURE: no canvas, just the
 * value contract every view relies on (opacity multiplier, screen shift with `y` = a RISE, effective-asset
 * field overlay, and the null fast-path that keeps un-animated tiles byte-identical).
 */
import { resolveAssetAnimation } from '@/engine/render/assetAnimation'
import type { SettingsAnimation } from '@/engine/animation/tileAnimation'
import { ASCII_STYLE, EMOJI_STYLE } from '@/game/artStyle'
import type { GridAsset } from '@/engine/IsometricGrid'

const baseAsset = (over: Partial<GridAsset> = {}): GridAsset =>
  ({ art: ['?'], col: 2, row: 2, type: 'decoration', color: '#123456', placedAt: 0, ...over } as GridAsset)

const anim = (over: Partial<SettingsAnimation> = {}): SettingsAnimation => ({
  id: 'a1',
  kind: 'settings',
  durationMs: 1000,
  tracks: [{ setting: 'opacity', from: 1, to: 0 }],
  ...over,
})

describe('resolveAssetAnimation — the null fast-path (byte-identical when nothing applies)', () => {
  test('no animations → null', () => {
    expect(resolveAssetAnimation(baseAsset(), 500, EMOJI_STYLE, 'iso')).toBeNull()
    expect(resolveAssetAnimation(baseAsset({ animations: [] }), 500, EMOJI_STYLE, 'iso')).toBeNull()
  })

  test('a VIEW-scoped animation is null in the wrong view', () => {
    const a = baseAsset({ animations: [anim({ scope: { views: ['iso'] } })] })
    expect(resolveAssetAnimation(a, 500, EMOJI_STYLE, '2d')).toBeNull()
    expect(resolveAssetAnimation(a, 500, EMOJI_STYLE, 'top')).toBeNull()
    expect(resolveAssetAnimation(a, 500, EMOJI_STYLE, 'iso')).not.toBeNull()
  })

  test('a STYLE-scoped animation is null under the wrong style', () => {
    const a = baseAsset({ animations: [anim({ scope: { styles: ['emoji'] } })] })
    expect(resolveAssetAnimation(a, 500, ASCII_STYLE, 'iso')).toBeNull()
    expect(resolveAssetAnimation(a, 500, EMOJI_STYLE, 'iso')).not.toBeNull()
  })

  test('a sprite-only animation contributes no settings → null', () => {
    const a = baseAsset({ animations: [{ id: 's', kind: 'sprite', durationMs: 500, frames: ['f0', 'f1'] }] })
    expect(resolveAssetAnimation(a, 250, EMOJI_STYLE, 'iso')).toBeNull()
  })
})

describe('resolveAssetAnimation — opacity is a MULTIPLIER over the animation window', () => {
  test('opacity 1→0 fades to 0 across the duration (anchored at placedAt)', () => {
    const a = baseAsset({ placedAt: 1000, animations: [anim()] })
    expect(resolveAssetAnimation(a, 1000, EMOJI_STYLE, 'iso')!.opacity).toBeCloseTo(1)
    expect(resolveAssetAnimation(a, 1500, EMOJI_STYLE, 'iso')!.opacity).toBeCloseTo(0.5)
    expect(resolveAssetAnimation(a, 2000, EMOJI_STYLE, 'iso')!.opacity).toBeCloseTo(0)
  })

  test('an asset without an opacity track reports the 1.0 (unchanged) multiplier', () => {
    const a = baseAsset({ animations: [anim({ tracks: [{ setting: 'y', from: 0, to: 2 }] })] })
    expect(resolveAssetAnimation(a, 500, EMOJI_STYLE, 'iso')!.opacity).toBe(1)
  })
})

describe('resolveAssetAnimation — screen shift: `y` is a RISE (positive = up)', () => {
  test('a y-track 0→2 grows the (positive) lift over time; x stays 0', () => {
    const a = baseAsset({ animations: [anim({ tracks: [{ setting: 'y', from: 0, to: 2 }] })] })
    const half = resolveAssetAnimation(a, 500, EMOJI_STYLE, 'iso')!
    const full = resolveAssetAnimation(a, 1000, EMOJI_STYLE, 'iso')!
    expect(half.y).toBeCloseTo(1)
    expect(full.y).toBeCloseTo(2)
    expect(full.y).toBeGreaterThan(half.y) // the lift keeps rising → the caller subtracts more from screenY
    expect(full.x).toBe(0)
  })

  test('an x-track drives the horizontal shift independently', () => {
    const a = baseAsset({ animations: [anim({ tracks: [{ setting: 'x', from: 0, to: 4 }] })] })
    expect(resolveAssetAnimation(a, 500, EMOJI_STYLE, 'iso')!.x).toBeCloseTo(2)
  })
})

describe('resolveAssetAnimation — field overlay (colour/zoom/width/height) onto the effective asset', () => {
  test('colour/zoom/width/height are overlaid; the base asset is NOT mutated', () => {
    const base = baseAsset({
      color: '#111111',
      animations: [anim({ durationMs: 1000, ease: 'linear', tracks: [
        { setting: 'color', from: '#000000', to: '#ffffff' },
        { setting: 'zoom', from: 1, to: 3 },
        { setting: 'width', from: 1, to: 2 },
        { setting: 'height', from: 1, to: 4 },
      ] })],
    })
    const fx = resolveAssetAnimation(base, 1000, EMOJI_STYLE, 'iso')!
    expect(fx.asset).not.toBe(base)          // a fresh clone (base untouched)
    expect(base.color).toBe('#111111')       // original not mutated
    expect(fx.asset.color).toBe('rgb(255, 255, 255)')
    expect(fx.asset.scale).toBeCloseTo(3)
    expect(fx.asset.scaleX).toBeCloseTo(2)
    expect(fx.asset.scaleY).toBeCloseTo(4)
  })

  test('an opacity-only animation writes no fields → the SAME asset reference (no needless clone)', () => {
    const base = baseAsset({ animations: [anim()] })
    const fx = resolveAssetAnimation(base, 500, EMOJI_STYLE, 'iso')!
    expect(fx.asset).toBe(base) // identity preserved → the draw reads the original fields
  })
})

describe('resolveAssetAnimation — animation COMPOSES with the base setting, it does not mask it (Image #40)', () => {
  test('ADDITIVE height: base scaleY 3 + a height track 1→4 renders 3→6 (base + delta), base stays editable', () => {
    const mk = (base: number) => baseAsset({
      scaleY: base,
      animations: [anim({ ease: 'linear', tracks: [{ setting: 'height', from: 1, to: 4 }] })],
    })
    // base 3: at the track start (t=0) → 3 + (1−1) = 3; at the end (t=DUR) → 3 + (4−1) = 6.
    expect(resolveAssetAnimation(mk(3), 0, EMOJI_STYLE, 'iso')!.asset.scaleY).toBeCloseTo(3)
    expect(resolveAssetAnimation(mk(3), 1000, EMOJI_STYLE, 'iso')!.asset.scaleY).toBeCloseTo(6)
    // editing the base to 2 shifts the whole range → 2→5 (the base slider is live under the animation).
    expect(resolveAssetAnimation(mk(2), 0, EMOJI_STYLE, 'iso')!.asset.scaleY).toBeCloseTo(2)
    expect(resolveAssetAnimation(mk(2), 1000, EMOJI_STYLE, 'iso')!.asset.scaleY).toBeCloseTo(5)
    // the fountain's base (height 1) is the additive identity → an unchanged 1→4.
    expect(resolveAssetAnimation(mk(1), 0, EMOJI_STYLE, 'iso')!.asset.scaleY).toBeCloseTo(1)
    expect(resolveAssetAnimation(mk(1), 1000, EMOJI_STYLE, 'iso')!.asset.scaleY).toBeCloseTo(4)
  })

  test('MULTIPLICATIVE zoom/width: base scale 2 × a zoom ratio 1→3 renders 2→6; a from of 0 falls back to the value', () => {
    const a = baseAsset({
      scale: 2, scaleX: 3,
      animations: [anim({ ease: 'linear', tracks: [
        { setting: 'zoom', from: 1, to: 3 },   // ratio ×1 → ×3
        { setting: 'width', from: 1, to: 2 },  // ratio ×1 → ×2
      ] })],
    })
    const end = resolveAssetAnimation(a, 1000, EMOJI_STYLE, 'iso')!.asset
    expect(end.scale).toBeCloseTo(6)  // base 2 × (3/1)
    expect(end.scaleX).toBeCloseTo(6) // base 3 × (2/1)
    // guard: a MULTIPLICATIVE track whose `from` is 0 has no ratio → fall back to the absolute value.
    const z0 = baseAsset({ scale: 2, animations: [anim({ ease: 'linear', tracks: [{ setting: 'zoom', from: 0, to: 4 }] })] })
    expect(resolveAssetAnimation(z0, 1000, EMOJI_STYLE, 'iso')!.asset.scale).toBeCloseTo(4)
  })

  test('base ZOOM still applies while HEIGHT animates (the "only zoom applied" report) — both compose', () => {
    const a = baseAsset({
      scale: 0.5, scaleY: 3, // reduced zoom + raised height, together
      animations: [anim({ ease: 'linear', tracks: [{ setting: 'height', from: 1, to: 4 }] })],
    })
    const end = resolveAssetAnimation(a, 1000, EMOJI_STYLE, 'iso')!.asset
    expect(end.scaleY).toBeCloseTo(6) // height composed (3 + 3) — NOT masked by the animation
    expect(end.scale).toBeCloseTo(0.5) // base zoom preserved alongside the active height animation
  })
})

describe('resolveAssetAnimation — the `night` trigger gates playback to night mode', () => {
  // A night-triggered flicker (opacity 1→0) — the lamp default: OFF in day, ON at night.
  const nightAnim = () => anim({ trigger: { on: 'night' }, tracks: [{ setting: 'opacity', from: 1, to: 0 }] })

  test('a night-trigger animation is INERT in day mode (null → byte-identical, no flicker)', () => {
    const a = baseAsset({ placedAt: 0, animations: [nightAnim()] })
    // explicit day, and the DEFAULT (omitted dayNight) must both be inert.
    expect(resolveAssetAnimation(a, 500, EMOJI_STYLE, 'iso', 'day')).toBeNull()
    expect(resolveAssetAnimation(a, 500, EMOJI_STYLE, 'iso')).toBeNull()
  })

  test('a night-trigger animation is ACTIVE at night (the flicker plays)', () => {
    const a = baseAsset({ placedAt: 0, animations: [nightAnim()] })
    const fx = resolveAssetAnimation(a, 500, EMOJI_STYLE, 'iso', 'night')
    expect(fx).not.toBeNull()
    expect(fx!.opacity).toBeCloseTo(0.5) // halfway through the 1→0 fade → the bulb is dimming
  })

  test('a NON-night animation (load/default) plays regardless of day or night', () => {
    const a = baseAsset({ placedAt: 0, animations: [anim({ trigger: { on: 'load' } })] })
    expect(resolveAssetAnimation(a, 500, EMOJI_STYLE, 'iso', 'day')).not.toBeNull()
    expect(resolveAssetAnimation(a, 500, EMOJI_STYLE, 'iso', 'night')).not.toBeNull()
  })

  test('with a night + a load animation, day drops ONLY the night one', () => {
    // load: opacity 1→0 (halves at t=500); night: height 1→4 — at day only the load contributes.
    const a = baseAsset({ placedAt: 0, animations: [
      anim({ id: 'load', trigger: { on: 'load' } }),
      anim({ id: 'night', trigger: { on: 'night' }, ease: 'linear', tracks: [{ setting: 'height', from: 1, to: 4 }] }),
    ] })
    const day = resolveAssetAnimation(a, 500, EMOJI_STYLE, 'iso', 'day')!
    expect(day.opacity).toBeCloseTo(0.5)          // the load fade still plays
    expect(day.asset.scaleY ?? 1).toBeCloseTo(1)   // the night height track is gated out → base height
    const night = resolveAssetAnimation(a, 500, EMOJI_STYLE, 'iso', 'night')!
    expect(night.asset.scaleY).toBeGreaterThan(1)  // at night the height grow contributes
  })

  test('the lamp night-LIT glow: a STEADY night colour (from==to) lights the bulb at night, unlit in day', () => {
    // The DEFAULT lamp bulb behaviour (Alexander: "the bulb should change appearance when night mode = true").
    // A night-triggered `color` track that HOLDS a warm value (from == to) → a steady LIT look, NOT a flicker.
    const lit = anim({
      id: 'lamp_night_lit', trigger: { on: 'night' }, ease: 'linear',
      tracks: [{ setting: 'color', from: '#ffe9a0', to: '#ffe9a0' }],
    })
    const bulb = baseAsset({ placedAt: 0, color: '#cccccc', animations: [lit] })
    // DAY: the night animation is gated out → no override → the bulb keeps its base (unlit) colour.
    expect(resolveAssetAnimation(bulb, 500, EMOJI_STYLE, 'iso', 'day')).toBeNull()
    // NIGHT: the colour last-wins-tints the bulb warm, and STEADILY (same value early + mid-loop → no flicker).
    const early = resolveAssetAnimation(bulb, 0, EMOJI_STYLE, 'iso', 'night')!
    const mid = resolveAssetAnimation(bulb, 500, EMOJI_STYLE, 'iso', 'night')!
    expect(early.asset.color).toBe(mid.asset.color) // steady — the colour never changes across the loop
    expect(mid.asset.color).not.toBe('#cccccc')      // and it is CHANGED from the base/day colour (lit up)
    const rgb = /rgb\((\d+), (\d+), (\d+)\)/.exec(String(mid.asset.color))!
    expect(Number(rgb[1])).toBeGreaterThan(Number(rgb[3])) // warm glow — red channel above blue
  })

  test('a lit + flickering failing bulb: the night colour AND the opacity flicker both apply (different settings)', () => {
    // The failing variant carries BOTH — they compose because they write DIFFERENT settings (colour vs opacity).
    const lit = anim({ id: 'lamp_night_lit', trigger: { on: 'night' }, ease: 'linear', tracks: [{ setting: 'color', from: '#ffe9a0', to: '#ffe9a0' }] })
    const flick = anim({ id: 'lamp_flicker', trigger: { on: 'night' }, tracks: [{ setting: 'opacity', from: 1, to: 0 }] })
    const bulb = baseAsset({ placedAt: 0, color: '#cccccc', animations: [lit, flick] })
    const fx = resolveAssetAnimation(bulb, 500, EMOJI_STYLE, 'iso', 'night')!
    expect(fx.asset.color).not.toBe('#cccccc') // lit (colour applied)
    expect(fx.opacity).toBeCloseTo(0.5)         // AND flickering (opacity dipping) — both at once
  })
})

describe('resolveAssetAnimation — chaining via start delays over one shared placedAt anchor', () => {
  test('a delayed second animation holds its `from` until its start delay elapses', () => {
    // A: y-rise 0→2 over 1000ms; B: opacity 1→0 starting after a 1000ms delay. Sampled at t=500 (only A moving).
    const a = baseAsset({ placedAt: 0, animations: [
      anim({ id: 'A', tracks: [{ setting: 'y', from: 0, to: 2 }] }),
      anim({ id: 'B', startDelayMs: 1000, tracks: [{ setting: 'opacity', from: 1, to: 0 }] }),
    ] })
    const mid = resolveAssetAnimation(a, 500, EMOJI_STYLE, 'iso')!
    expect(mid.y).toBeCloseTo(1)     // A is halfway
    expect(mid.opacity).toBeCloseTo(1) // B hasn't started → holds `from` (fully opaque)
    const late = resolveAssetAnimation(a, 1500, EMOJI_STYLE, 'iso')!
    expect(late.y).toBeCloseTo(2)      // A settled at its end
    expect(late.opacity).toBeCloseTo(0.5) // B is now halfway through its fade
  })
})
