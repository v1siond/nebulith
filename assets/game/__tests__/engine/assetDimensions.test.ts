import { resolveAssetDrawSize } from '@/engine/render/assetDimensions'

/**
 * THE THREE SIZE AXES, and the fact that there are only three.
 *
 * View semantics:
 *   billboard (iso + 2D): horizontal = Width, vertical = Height (grows UP from the base)
 *   overhead (top):       horizontal = Width, vertical = Depth (the into-screen ground axis seen from above)
 *
 * Each control means ONE thing. Which of them happens to be vertical ON SCREEN depends on where the
 * camera is, and that is the only thing that changes between views.
 *
 * Base is the renderer's existing fixed sprite size.
 */

const BASE = 100

describe('resolveAssetDrawSize, defaults (no dims set)', () => {
  it('billboard: undefined dims render at the base square, no lift', () => {
    expect(resolveAssetDrawSize(BASE, {}, 'billboard')).toEqual({ w: 100, h: 100, baseLift: 0 })
  })
  it('overhead: undefined dims render at the base square, no lift', () => {
    expect(resolveAssetDrawSize(BASE, {}, 'overhead')).toEqual({ w: 100, h: 100, baseLift: 0 })
  })
})

describe('Width stretches horizontally in every view', () => {
  it('billboard: width 1.5 widens only, height unchanged, no lift', () => {
    expect(resolveAssetDrawSize(BASE, { width: 1.5 }, 'billboard')).toEqual({ w: 150, h: 100, baseLift: 0 })
  })
  it('overhead: width 1.5 widens only', () => {
    expect(resolveAssetDrawSize(BASE, { width: 1.5 }, 'overhead')).toEqual({ w: 150, h: 100, baseLift: 0 })
  })
})

describe('Height grows UP, and only where up is on screen', () => {
  it('billboard: height 3 makes it 3x tall and lifts by (300-100)/2 = 100 so the base is fixed', () => {
    expect(resolveAssetDrawSize(BASE, { height: 3 }, 'billboard')).toEqual({ w: 100, h: 300, baseLift: 100 })
  })
  it('overhead: height has NO effect, because you are looking straight down that axis', () => {
    expect(resolveAssetDrawSize(BASE, { height: 3 }, 'overhead')).toEqual({ w: 100, h: 100, baseLift: 0 })
  })
})

describe('Depth is the into-screen axis, and it is a SIZE', () => {
  it('overhead: depth 2 stretches the ground axis, which is vertical from above', () => {
    expect(resolveAssetDrawSize(BASE, { depth: 2 }, 'overhead')).toEqual({ w: 100, h: 200, baseLift: 0 })
  })
  it('billboard: depth has no on-screen axis of its own on a flat billboard', () => {
    expect(resolveAssetDrawSize(BASE, { depth: 2 }, 'billboard')).toEqual({ w: 100, h: 100, baseLift: 0 })
  })

  /**
   * GATE 3, the half of it this resolver owns.
   *
   * Depth used to be a SIZE from above and a THICKNESS from the side, so one control answered two
   * different questions and which one depended on the camera. It is a size in both now. This resolver
   * never thins anything at all, in either view, which is what makes that true here: thinning is the
   * `thickness` reaches, and they live in the shape drawer.
   */
  it('scales the same way in both views: never shrinks below the base, never thins', () => {
    for (const view of ['billboard', 'overhead'] as const) {
      const bigger = resolveAssetDrawSize(BASE, { depth: 2 }, view)
      const smaller = resolveAssetDrawSize(BASE, { depth: 0.3 }, view)

      expect(bigger.w).toBe(BASE)
      expect(smaller.w).toBe(BASE)
      // Where depth has an on-screen axis it sizes it, up AND down, monotonically.
      expect(bigger.h).toBeGreaterThanOrEqual(smaller.h)
    }
  })
})

describe('there is no fourth multiplier', () => {
  it('the axes are the only size, so an unknown key changes nothing', () => {
    // Zoom was a fourth number that multiplied the three rather than replacing them, so Width 2 with
    // Zoom 2 drew at 4 and no panel said so. Passing the old key now does exactly nothing.
    const withOldZoom = resolveAssetDrawSize(BASE, { width: 1.5, scale: 2 } as never, 'billboard')

    expect(withOldZoom).toEqual({ w: 150, h: 100, baseLift: 0 })
  })

  it('combines the axes and nothing else', () => {
    expect(resolveAssetDrawSize(BASE, { width: 1.5, height: 2 }, 'billboard'))
      .toEqual({ w: 150, h: 200, baseLift: 50 })
    expect(resolveAssetDrawSize(BASE, { width: 1.5, height: 9, depth: 2 }, 'overhead'))
      .toEqual({ w: 150, h: 200, baseLift: 0 })
  })
})
