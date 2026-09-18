/**
 * The near-hero fade in the 2D and top views. Same distance rule as the iso view, for any tile that opted into
  * `fadeNear`.
 */
import { nearFadeAlpha, revealAlpha } from '@/engine/render/roofReveal'

const tree = { fadeNear: true }
const hero = { col: 10, row: 10 }

describe('nearFadeAlpha', () => {
  it('a tree right by the hero is see-through', () => {
    expect(nearFadeAlpha(tree, 10, 11, hero)).toBeLessThan(0.5)
  })

  it('a tree far from the hero is solid', () => {
    expect(nearFadeAlpha(tree, 30, 30, hero)).toBe(1)
  })

  it('fades by the same rule as the iso view', () => {
    expect(nearFadeAlpha(tree, 12, 10, hero)).toBe(revealAlpha({ dist: 2, inside: false }))
  })

  it('a tile that did not opt in never fades, however close', () => {
    expect(nearFadeAlpha(undefined, 10, 10, hero)).toBe(1)
    expect(nearFadeAlpha({}, 10, 10, hero)).toBe(1)
  })

  it('with no hero on screen (a preview) nothing fades', () => {
    expect(nearFadeAlpha(tree, 10, 10, null)).toBe(1)
  })

  it("a tile's own floor holds: a door stays mostly opaque", () => {
    expect(nearFadeAlpha({ fadeNear: true, minAlpha: 0.9 }, 10, 10, hero)).toBeGreaterThanOrEqual(0.9)
  })
})
