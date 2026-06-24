import { ASSET_ANIMATIONS, isAnimatedAssetType, assetAnimFrame, ANIMATION_LIBRARY, animationOptions, assetCycleFrame } from '@/engine/assetAnimations'

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

  it('ANIMATION_LIBRARY is keyed by Animation.id and animationOptions lists them', () => {
    expect(ANIMATION_LIBRARY['flower-sway']).toBe(ASSET_ANIMATIONS.flower)
    expect(ANIMATION_LIBRARY['lamp-flicker']).toBeDefined()
    const ids = animationOptions().map(o => o.id)
    expect(ids).toContain('flower-sway')
    expect(ids).toContain('bush-rustle')
  })

  it('assetCycleFrame plays an asset\'s authored always-cycle (null without cycles)', () => {
    const cycles = [
      { id: 'c', animations: ['flower-sway'], mode: 'sequential' as const, delayMs: 0, trigger: { kind: 'always' as const } },
    ]
    expect(assetCycleFrame(cycles, 0)).toEqual(ASSET_ANIMATIONS.flower.frames[0])
    expect(assetCycleFrame(undefined, 0)).toBeNull()
    expect(assetCycleFrame([], 0)).toBeNull()
  })
})
