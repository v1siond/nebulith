import { ASSET_ANIMATIONS, isAnimatedAssetType, assetAnimFrame } from '@/engine/assetAnimations'

describe('assetAnimations — ambient per-type asset animation', () => {
  it('knows which types animate', () => {
    expect(isAnimatedAssetType('flower')).toBe(true)
    expect(isAnimatedAssetType('lamp')).toBe(true)
    expect(isAnimatedAssetType('tree')).toBe(false) // trees use the layered renderer, not this
  })

  it('cycles the flower through its frames over time (and loops)', () => {
    const f = ASSET_ANIMATIONS.flower
    const per = f.durationMs / f.frames.length // 400ms per frame
    expect(assetAnimFrame('flower', 0)).toEqual(f.frames[0])
    expect(assetAnimFrame('flower', per)).toEqual(f.frames[1])
    expect(assetAnimFrame('flower', per * 3)).toEqual(f.frames[3])
    expect(assetAnimFrame('flower', f.durationMs)).toEqual(f.frames[0]) // wraps
  })

  it('is deterministic — same (type, now) → same frame', () => {
    expect(assetAnimFrame('lamp', 1234)).toEqual(assetAnimFrame('lamp', 1234))
  })

  it('returns null for a type with no ambient animation (renderer keeps static art)', () => {
    expect(assetAnimFrame('building', 500)).toBeNull()
    expect(assetAnimFrame('tree', 500)).toBeNull()
  })
})
