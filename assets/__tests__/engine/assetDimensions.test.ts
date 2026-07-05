import { resolveAssetDrawSize } from '@/engine/render/assetDimensions'

// #77/#78 — per-element dimensions resolved into a draw (w, h) + a bottom-anchor lift.
// View semantics (locked with the user):
//   billboard (iso + 2D): horizontal = Width (scaleX), vertical = Height (scaleY, grows UP from base)
//   overhead (top):       horizontal = Width (scaleX), vertical = Depth  (scaleZ)
//   Zoom (scale) multiplies whatever axes the view uses.
// Base is the renderer's existing fixed sprite size.

const BASE = 100

describe('resolveAssetDrawSize — defaults (no dims set)', () => {
  it('billboard: undefined dims render at the base square, no lift', () => {
    expect(resolveAssetDrawSize(BASE, {}, 'billboard')).toEqual({ w: 100, h: 100, baseLift: 0 })
  })
  it('overhead: undefined dims render at the base square, no lift', () => {
    expect(resolveAssetDrawSize(BASE, {}, 'overhead')).toEqual({ w: 100, h: 100, baseLift: 0 })
  })
})

describe('resolveAssetDrawSize — uniform Zoom (scale)', () => {
  it('billboard: zoom 2 doubles both axes and lifts the center so the base stays planted', () => {
    // h grows base→200, so the center must rise (200-100)/2 = 50 to keep the bottom fixed.
    expect(resolveAssetDrawSize(BASE, { scale: 2 }, 'billboard')).toEqual({ w: 200, h: 200, baseLift: 50 })
  })
  it('overhead: zoom 2 doubles both axes, no lift (overhead is center-anchored)', () => {
    expect(resolveAssetDrawSize(BASE, { scale: 2 }, 'overhead')).toEqual({ w: 200, h: 200, baseLift: 0 })
  })
})

describe('resolveAssetDrawSize — Width (scaleX) stretches horizontally in every view', () => {
  it('billboard: width 1.5 widens only, height unchanged, no lift', () => {
    expect(resolveAssetDrawSize(BASE, { scaleX: 1.5 }, 'billboard')).toEqual({ w: 150, h: 100, baseLift: 0 })
  })
  it('overhead: width 1.5 widens only', () => {
    expect(resolveAssetDrawSize(BASE, { scaleX: 1.5 }, 'overhead')).toEqual({ w: 150, h: 100, baseLift: 0 })
  })
})

describe('resolveAssetDrawSize — Height (scaleY) grows UP in billboard views only', () => {
  it('billboard: height 3 makes it 3× tall and lifts by (300-100)/2 = 100 so the base is fixed', () => {
    expect(resolveAssetDrawSize(BASE, { scaleY: 3 }, 'billboard')).toEqual({ w: 100, h: 300, baseLift: 100 })
  })
  it('overhead: height has NO effect (looking straight down the vertical axis)', () => {
    expect(resolveAssetDrawSize(BASE, { scaleY: 3 }, 'overhead')).toEqual({ w: 100, h: 100, baseLift: 0 })
  })
})

describe('resolveAssetDrawSize — Depth (scaleZ) stretches vertically in the overhead view only', () => {
  it('overhead: depth 2 stretches the ground-y axis, no lift', () => {
    expect(resolveAssetDrawSize(BASE, { scaleZ: 2 }, 'overhead')).toEqual({ w: 100, h: 200, baseLift: 0 })
  })
  it('billboard: depth has NO effect (no into-screen axis on a flat billboard)', () => {
    expect(resolveAssetDrawSize(BASE, { scaleZ: 2 }, 'billboard')).toEqual({ w: 100, h: 100, baseLift: 0 })
  })
})

describe('resolveAssetDrawSize — combined Zoom × per-axis', () => {
  it('billboard: zoom 2 × width 1.5 × height 2 → w=300, h=400, lift=(400-100)/2=150', () => {
    expect(resolveAssetDrawSize(BASE, { scale: 2, scaleX: 1.5, scaleY: 2 }, 'billboard'))
      .toEqual({ w: 300, h: 400, baseLift: 150 })
  })
  it('overhead: zoom 2 × width 1.5 × depth 2 → w=300, h=400; height ignored; no lift', () => {
    expect(resolveAssetDrawSize(BASE, { scale: 2, scaleX: 1.5, scaleY: 9, scaleZ: 2 }, 'overhead'))
      .toEqual({ w: 300, h: 400, baseLift: 0 })
  })
})
