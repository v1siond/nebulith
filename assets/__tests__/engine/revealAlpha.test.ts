/**
 * HOW TRANSPARENT a building tile draws — the one alpha rule for the reveal.
 *
 * Alexander (2026-09-06): *"I should be able to see transaprent from a certain distance of the house, for
 * example, would I know that there's a door in a building if I can't see it? plus doors should be more opaque
 * and obvious"*.
 *
 * Three bands, plus a per-tile floor:
 *  - FAR      → fully opaque. A building you are nowhere near is a solid building.
 *  - APPROACH → eases translucent as you close in, so you can read the facade and find its door.
 *  - INSIDE   → the deep reveal: you are under the roof, the shell drops right back so the room reads.
 *  - `minAlpha` is a per-tile SETTING (backend data, not a name check in the renderer): the DOOR carries a high
 *    one so it stays opaque and obvious while the wall around it fades away.
 */
import { revealAlpha, APPROACH_RADIUS, APPROACH_ALPHA, INTERIOR_SHELL_ALPHA } from '@/engine/render/roofReveal'

describe('revealAlpha — far is solid, approach eases, inside reveals', () => {
  test('far from the building → fully opaque', () => {
    expect(revealAlpha({ dist: APPROACH_RADIUS, inside: false })).toBe(1)
    expect(revealAlpha({ dist: APPROACH_RADIUS + 10, inside: false })).toBe(1)
  })

  test('closing in eases it translucent, bottoming out at APPROACH_ALPHA', () => {
    expect(revealAlpha({ dist: 0, inside: false })).toBeCloseTo(APPROACH_ALPHA)
    const near = revealAlpha({ dist: 1, inside: false })
    const far = revealAlpha({ dist: 3, inside: false })
    expect(near).toBeGreaterThanOrEqual(APPROACH_ALPHA)
    expect(far).toBeGreaterThanOrEqual(near) // monotonic: further away is never MORE transparent
    expect(far).toBeLessThan(1)
  })

  // Alexander 2026-09-06, Image #9: "My user is close to the house but I can't see the doors because they're
  // located on the non visible part of the map and the opacity change didn't trigger". The old smoothstep was
  // far too gradual — at 4 cells out it computed ~0.96, i.e. no visible change at all. Standing NEAR a building
  // must actually make it see-through, not almost-solid.
  test('being NEAR the building is an unmistakable change, not a 4% one', () => {
    expect(revealAlpha({ dist: 2, inside: false })).toBeLessThanOrEqual(0.6)
    expect(revealAlpha({ dist: 3, inside: false })).toBeLessThan(0.85)
  })

  test('the ease holds flat at its most transparent across the whole close band', () => {
    expect(revealAlpha({ dist: 0, inside: false })).toBeCloseTo(APPROACH_ALPHA)
    expect(revealAlpha({ dist: 1.5, inside: false })).toBeCloseTo(APPROACH_ALPHA)
  })

  test('INSIDE the building the shell drops to INTERIOR_SHELL_ALPHA, well past the approach ease', () => {
    const inside = revealAlpha({ dist: 0, inside: true })
    expect(inside).toBeCloseTo(INTERIOR_SHELL_ALPHA)
    expect(inside).toBeLessThan(revealAlpha({ dist: 0, inside: false }))
  })

  test('a tile with a high minAlpha (the DOOR) stays opaque and obvious in every band', () => {
    expect(revealAlpha({ dist: 0, inside: true, minAlpha: 0.9 })).toBeCloseTo(0.9)
    expect(revealAlpha({ dist: 1, inside: false, minAlpha: 0.9 })).toBeGreaterThanOrEqual(0.9)
  })

  test('minAlpha never makes a tile MORE transparent than the band would', () => {
    expect(revealAlpha({ dist: 99, inside: false, minAlpha: 0.9 })).toBe(1)
  })
})
