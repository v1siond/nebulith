// The roof is JUST stacked tiles: instead of one flat roof lid per footprint cell, each column gets a STACK
// of roof blocks whose height forms a peaked gable — a flat ridge in the middle sloping down to the eaves.
// Those same stacked roof tiles then project to a TRIANGLE (2D front), a 3D GABLE (iso), and the footprint
// RECTANGLE (top) — one stacked-tile structure, three views (Alexander's 3-view house reference). Pure geometry.
import { gableRoofLevels } from '@/engine/gableRoof'

// A 5-wide footprint (cols 10..14). ROOF_ROWS = 2 (rise), ROOF_RIDGE_FRAC = 0.46 (flat-top width).
const rect = { col: 10, w: 5 }

describe('gableRoofLevels — roof blocks stacked into a peaked gable', () => {
  test('the RIDGE (centre column) gets the full stack = 1 + ROOF_ROWS', () => {
    expect(gableRoofLevels(12, rect, 2, 0.46)).toBe(3)
  })

  test('the EAVES (outer columns) still get 1 roof block — the roof covers the WHOLE footprint from above', () => {
    expect(gableRoofLevels(10, rect, 2, 0.46)).toBe(1)
    expect(gableRoofLevels(14, rect, 2, 0.46)).toBe(1)
  })

  test('it slopes DOWN from the ridge to the eaves and is SYMMETRIC', () => {
    const levels = [10, 11, 12, 13, 14].map(c => gableRoofLevels(c, rect, 2, 0.46))
    expect(levels[0]).toBeLessThanOrEqual(levels[1])
    expect(levels[1]).toBeLessThanOrEqual(levels[2])
    expect(levels[2]).toBeGreaterThanOrEqual(levels[3])
    expect(levels[3]).toBeGreaterThanOrEqual(levels[4])
    expect(levels[0]).toBe(levels[4]) // symmetric eaves
    expect(Math.max(...levels)).toBe(3) // peaks at the ridge
    expect(Math.min(...levels)).toBe(1) // never below the covering layer
  })

  test('a 1-wide footprint is all ridge (full stack, no slope to compute)', () => {
    expect(gableRoofLevels(10, { col: 10, w: 1 }, 2, 0.46)).toBe(3)
  })
})
