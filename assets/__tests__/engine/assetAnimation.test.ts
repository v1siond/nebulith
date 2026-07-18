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
