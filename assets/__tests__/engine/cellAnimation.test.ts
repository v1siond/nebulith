import {
  transformAt,
  assetCellTransform,
  easeT,
  makeCellAnimation,
  restFrame,
  REST,
  WIND_SWAY,
  CELL_ANIM_PRESETS,
  type CellAnimation,
  type AnimFrame,
} from '@/engine/cellAnimation'

// A 4-frame sway: rest → right → left → right (the doc's leaf-wind example).
const sway = (over: Partial<CellAnimation> = {}): CellAnimation => ({
  id: 'sway',
  cells: [{ col: 0, row: 0 }],
  frames: [
    { dx: 0, dy: 0 },
    { dx: 0.2, dy: 0 },
    { dx: -0.2, dy: 0 },
    { dx: 0.2, dy: 0 },
  ],
  durationMs: 1200, // 3 segments → 400ms each
  delayMs: 400,
  loop: true,
  trigger: 'always',
  ease: 'linear',
  ...over,
})

describe('cellAnimation — pure frame clock + interpolation', () => {
  describe('transformAt — frame selection across the loop', () => {
    it('hits every frame endpoint exactly (frame 0 at t=0, interior frames on the grid)', () => {
      const a = sway()
      expect(transformAt(a, 0)).toEqual({ dx: 0, dy: 0, rot: 0, scale: 1 }) // frame 0
      expect(transformAt(a, 400).dx).toBeCloseTo(0.2) // frame 1
      expect(transformAt(a, 800).dx).toBeCloseTo(-0.2) // frame 2
    })

    it('interpolates linearly between frame endpoints (midpoint = average)', () => {
      const a = sway()
      // halfway between frame 0 (0) and frame 1 (0.2) → 0.1
      expect(transformAt(a, 200).dx).toBeCloseTo(0.1)
      // halfway between frame 1 (0.2) and frame 2 (-0.2) → 0
      expect(transformAt(a, 600).dx).toBeCloseTo(0)
    })

    it('the delay tail holds the LAST frame (no snap-back during the pause)', () => {
      const a = sway() // duration 1200, delay 400, last frame dx=0.2
      expect(transformAt(a, 1200).dx).toBeCloseTo(0.2) // exactly at end of run → last frame
      expect(transformAt(a, 1400).dx).toBeCloseTo(0.2) // mid-delay → still last frame
      expect(transformAt(a, 1599).dx).toBeCloseTo(0.2) // just before loop → still last frame
    })

    it('wraps on duration+delay so the loop repeats', () => {
      const a = sway() // period = 1600
      expect(transformAt(a, 1600)).toEqual(transformAt(a, 0)) // back to frame 0
      expect(transformAt(a, 2000).dx).toBeCloseTo(transformAt(a, 400).dx) // one full loop later
    })

    it('non-looping animation holds the last frame past the end instead of wrapping', () => {
      const a = sway({ loop: false })
      expect(transformAt(a, 5000).dx).toBeCloseTo(0.2) // held, not wrapped to rest
    })
  })

  describe('transformAt — degenerate inputs resolve to rest', () => {
    it('empty frames → rest', () => {
      expect(transformAt(sway({ frames: [] }), 123)).toEqual(REST)
    })

    it('single (rest) frame → rest (nothing to move)', () => {
      expect(transformAt(sway({ frames: [{ dx: 0, dy: 0 }] }), 123)).toEqual(REST)
    })

    it('zero duration → holds frame 0', () => {
      const a = sway({ durationMs: 0 })
      expect(transformAt(a, 123)).toEqual({ dx: 0, dy: 0, rot: 0, scale: 1 })
    })

    it('resolves optional rot/scale to defaults (0 and 1)', () => {
      const a = sway({
        frames: [
          { dx: 0, dy: 0 },
          { dx: 0, dy: 0, rot: 1, scale: 2 },
        ],
        durationMs: 100,
        delayMs: 100, // a hold window so t=150 lands in the delay tail
      })
      expect(transformAt(a, 150)).toEqual({ dx: 0, dy: 0, rot: 1, scale: 2 }) // last frame held
      const mid = transformAt(a, 50)
      expect(mid.rot).toBeCloseTo(0.5)
      expect(mid.scale).toBeCloseTo(1.5)
    })
  })

  describe('easeT', () => {
    it('linear is the identity; defaults to linear', () => {
      expect(easeT('linear', 0.25)).toBeCloseTo(0.25)
      expect(easeT(undefined, 0.25)).toBeCloseTo(0.25)
    })

    it('sine is ease-in-out: endpoints fixed, faster through the middle', () => {
      expect(easeT('sine', 0)).toBeCloseTo(0)
      expect(easeT('sine', 1)).toBeCloseTo(1)
      expect(easeT('sine', 0.5)).toBeCloseTo(0.5) // symmetric midpoint
      expect(easeT('sine', 0.25)).toBeLessThan(0.25) // eased-in (slower start)
    })
  })

  describe('assetCellTransform — render-side guard', () => {
    it('returns the live transform for an always-on multi-frame animation', () => {
      const a = sway()
      expect(assetCellTransform(a, 400)?.dx).toBeCloseTo(0.2)
    })

    it('returns null for no animation, a single frame, or a non-always trigger', () => {
      expect(assetCellTransform(undefined, 0)).toBeNull()
      expect(assetCellTransform(sway({ frames: [restFrame()] }), 0)).toBeNull()
      expect(assetCellTransform(sway({ trigger: 'on-interact' }), 400)).toBeNull()
    })
  })

  describe('makeCellAnimation', () => {
    it('copies cells + frames (no aliasing) and clamps/rounds timing', () => {
      const cells = [{ col: 1, row: 2 }]
      const frames: AnimFrame[] = [restFrame(), { dx: 0.1, dy: 0 }]
      const a = makeCellAnimation(cells, frames, { durationMs: 900.6, delayMs: -10, loop: false, ease: 'sine' })
      expect(a.cells).toEqual(cells)
      expect(a.cells).not.toBe(cells)
      expect(a.frames).not.toBe(frames)
      expect(a.frames[1]).not.toBe(frames[1])
      expect(a.durationMs).toBe(901)
      expect(a.delayMs).toBe(0) // clamped ≥ 0
      expect(a.loop).toBe(false)
      expect(a.trigger).toBe('always') // default
    })
  })

  describe('built-in presets', () => {
    it('ships a wind/sway preset (the doc 4-frame leaf example) so wind works out of the box', () => {
      expect(WIND_SWAY.frames).toHaveLength(4)
      expect(WIND_SWAY.frames[0]).toEqual({ dx: 0, dy: 0 }) // frame 0 = rest
      expect(WIND_SWAY.frames[1].dx).toBeGreaterThan(0) // right
      expect(WIND_SWAY.frames[2].dx).toBeLessThan(0) // left
      // a built preset actually animates through assetCellTransform
      const anim = makeCellAnimation([{ col: 0, row: 0 }], WIND_SWAY.frames, WIND_SWAY)
      expect(assetCellTransform(anim, WIND_SWAY.durationMs / 3)?.dx).toBeCloseTo(WIND_SWAY.frames[1].dx, 1)
    })

    it('every preset has a rest frame 0 and at least 3 frames', () => {
      for (const p of CELL_ANIM_PRESETS) {
        // frame 0 = rest: no positional/rotational offset (an explicit scale:1 is fine).
        expect(p.frames[0].dx).toBe(0)
        expect(p.frames[0].dy).toBe(0)
        expect(p.frames[0].rot ?? 0).toBe(0)
        expect(p.frames.length).toBeGreaterThanOrEqual(3)
      }
    })
  })
})
