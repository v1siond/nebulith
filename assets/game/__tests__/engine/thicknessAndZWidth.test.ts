/**
 * THICKNESS MUST MEAN THE SAME THING EVERYWHERE IT IS READ.
 *
 * Two bugs, both reported from the editor and both traced to the same confusion between "a thickness map is
 * present" and "a thickness map actually thins something".
 *
 *   1. A map of four 1s reaches the whole cell every way, so it is the same shape as no map at all. The
 *      renderer read its mere presence as "thickness is in charge now" and dropped the tile's `scaleZ`
 *      squash, so a tile with four 1s drew a fat full cube while the identical tile with no map drew
 *      squashed. Pulling any one reach below 1 brought the squash back, which is the wrong way round.
 *
 *   2. A z-width box built its corners from the unit diamond unconditionally, so a tile asking for BOTH a
 *      span and a thickness got the span and lost the thickness without a word.
 */
import { isoDepthBox, reachGroundQuad, thicknessThins, unitGroundQuad, type ThicknessReach } from '@/engine/render/isoBlock'

const W = 16
const H = 8
const CENTRE = { x: 100, y: 100 }

describe('thicknessThins', () => {
  it('says no for a map that reaches the whole cell every way', () => {
    expect(thicknessThins({ 'right-down': 1, 'left-down': 1, 'right-up': 1, 'left-up': 1 })).toBe(false)
  })

  it('says no for an empty map and for none at all', () => {
    expect(thicknessThins({})).toBe(false)
    expect(thicknessThins(undefined)).toBe(false)
  })

  it('says yes as soon as one direction is pulled in', () => {
    expect(thicknessThins({ 'right-down': 0.15, 'left-down': 1 })).toBe(true)
  })

  it('ignores values that are not a real reach, the way reachOf does', () => {
    // 0 and above-1 both mean "all the way" to reachOf, so neither is a thinning.
    expect(thicknessThins({ 'right-down': 0 })).toBe(false)
    expect(thicknessThins({ 'right-down': 4 })).toBe(false)
  })
})

describe('a full-reach map is the same footprint as no map', () => {
  it('draws the unit cell, corner for corner', () => {
    const all1: ThicknessReach = { 'right-down': 1, 'left-down': 1, 'right-up': 1, 'left-up': 1 }
    expect(reachGroundQuad(W, H, all1)).toEqual(unitGroundQuad(W, H))
  })
})

describe('z-width and thickness coexist', () => {
  const span = 6
  const thin: ThicknessReach = { 'right-down': 0.15 }

  it('a spanning box with no thickness is exactly the box it always was', () => {
    const before = isoDepthBox(CENTRE, W, H, 12, span, 'left-down', 0)
    const after = isoDepthBox(CENTRE, W, H, 12, span, 'left-down', 0, undefined)
    expect(after).toEqual(before)
  })

  it('a spanning box THINS when the tile asks to, instead of ignoring it', () => {
    const full = isoDepthBox(CENTRE, W, H, 12, span, 'left-down', 0)
    const thinned = isoDepthBox(CENTRE, W, H, 12, span, 'left-down', 0, reachGroundQuad(W, H, thin))
    expect(thinned).not.toEqual(full)
  })

  it('the thinned box is NARROWER across, not merely moved', () => {
    const width = (box: ReturnType<typeof isoDepthBox>) => {
      const xs = [box.long, box.cap, box.top].flatMap(f => [f.a.x, f.b.x, f.c.x, f.d.x])
      return Math.max(...xs) - Math.min(...xs)
    }
    const full = isoDepthBox(CENTRE, W, H, 12, span, 'left-down', 0)
    const thinned = isoDepthBox(CENTRE, W, H, 12, span, 'left-down', 0, reachGroundQuad(W, H, thin))
    expect(width(thinned)).toBeLessThan(width(full))
  })

  it('still spans the cells it was asked for once thinned', () => {
    // The span is the long axis; thinning is across it, so the long face must not get shorter.
    const len = (box: ReturnType<typeof isoDepthBox>) => {
      const ys = [box.long.a.y, box.long.b.y, box.long.c.y, box.long.d.y]
      return Math.max(...ys) - Math.min(...ys)
    }
    const full = isoDepthBox(CENTRE, W, H, 12, span, 'left-down', 0)
    const thinned = isoDepthBox(CENTRE, W, H, 12, span, 'left-down', 0, reachGroundQuad(W, H, { 'right-down': 0.15 }))
    expect(len(thinned)).toBeCloseTo(len(full), 5)
  })
})
