/**
 * Per-cell GROUND/FLOOR dims — the goal: "the settings are available FOR EVERY TILE not just
 * decorations". A bare floor cell carries the SAME Width/Height/Depth/Zoom (+ a per-cell pose) a prop
 * carries, applied to that ONE floor cell. These pure units are the geometry contract both the 2D
 * (overhead) and iso ground renderers read; an unset cell MUST resolve to identity so the default
 * render stays byte-identical.
 */
import { groundSizeFactors, groundDimsActive } from '@/engine/groundDims'

describe('groundSizeFactors — floor Width/Depth/Zoom → draw factors (overhead x, ground y)', () => {
  test('unset dims → identity { fx: 1, fy: 1 } so the floor renders byte-identically', () => {
    expect(groundSizeFactors(undefined)).toEqual({ fx: 1, fy: 1 })
    expect(groundSizeFactors({})).toEqual({ fx: 1, fy: 1 })
  })
  test('Width (scaleX) stretches the horizontal factor only', () => {
    expect(groundSizeFactors({ scaleX: 2 })).toEqual({ fx: 2, fy: 1 })
  })
  test('Depth (scaleZ) stretches the ground (into-screen / vertical) factor only', () => {
    expect(groundSizeFactors({ scaleZ: 3 })).toEqual({ fx: 1, fy: 3 })
  })
  test('Zoom (scale) multiplies both axes', () => {
    expect(groundSizeFactors({ scale: 2 })).toEqual({ fx: 2, fy: 2 })
    expect(groundSizeFactors({ scaleX: 2, scaleZ: 3, scale: 2 })).toEqual({ fx: 4, fy: 6 })
  })
  test('Height (scaleY) has no axis on a flat floor → does not change the factors', () => {
    expect(groundSizeFactors({ scaleY: 5 })).toEqual({ fx: 1, fy: 1 })
  })
})

describe('groundDimsActive — is this floor cell overridden from the default?', () => {
  test('unset / all-identity → false (stays on the fast default path)', () => {
    expect(groundDimsActive(undefined)).toBe(false)
    expect(groundDimsActive({})).toBe(false)
    expect(groundDimsActive({ scaleX: 1, scaleY: 1, scaleZ: 1, scale: 1 })).toBe(false)
  })
  test('any non-identity size axis → true (incl. Height, so a set value persists/round-trips)', () => {
    expect(groundDimsActive({ scaleX: 2 })).toBe(true)
    expect(groundDimsActive({ scaleZ: 0.5 })).toBe(true)
    expect(groundDimsActive({ scale: 1.5 })).toBe(true)
    expect(groundDimsActive({ scaleY: 2 })).toBe(true)
  })
  test('a non-identity pose (offset/rotation) → true; an identity/empty pose → false', () => {
    expect(groundDimsActive({ pose: { dx: 0.3 } })).toBe(true)
    expect(groundDimsActive({ pose: { rot: 0.2 } })).toBe(true)
    expect(groundDimsActive({ pose: { scale: 1.5 } })).toBe(true)
    expect(groundDimsActive({ pose: {} })).toBe(false)
    expect(groundDimsActive({ pose: { scale: 1 } })).toBe(false)
  })
})
