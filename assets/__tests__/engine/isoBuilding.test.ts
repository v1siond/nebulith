import { isoFacingIndex, isoFacadeOnBack, buildingFadeAlpha } from '../../engine/isoBuilding'

describe('isoFacingIndex — map planner facing to the iso billboard axis', () => {
  test('horizontal-street facings (south/north) use axis 0 (facade along +col)', () => {
    expect(isoFacingIndex('south')).toBe(0)
    expect(isoFacingIndex('north')).toBe(0)
  })
  test('vertical-road facings (east/west) use axis 1 (facade along -row)', () => {
    expect(isoFacingIndex('east')).toBe(1)
    expect(isoFacingIndex('west')).toBe(1)
  })
})

describe('isoFacadeOnBack — door on the camera-far face for north/west', () => {
  test('south/east face the camera (door on the near/front face)', () => {
    expect(isoFacadeOnBack('south')).toBe(false)
    expect(isoFacadeOnBack('east')).toBe(false)
  })
  test('north/west face away (door on the far/back face, never toward near grass)', () => {
    expect(isoFacadeOnBack('north')).toBe(true)
    expect(isoFacadeOnBack('west')).toBe(true)
  })
})

describe('buildingFadeAlpha — proximity transparency', () => {
  const rect = { col: 5, row: 10, length: 3, height: 4 } // cols 5-7, rows 7-10

  test('fully opaque when the player is far away', () => {
    expect(buildingFadeAlpha(20, 20, rect, 3.5, 0.35)).toBe(1)
  })
  test('opaque exactly at the radius boundary', () => {
    expect(buildingFadeAlpha(6, 13, rect, 3, 0.35)).toBe(1) // 3 rows below bottom (row 10) = dist 3
  })
  test('most transparent when standing on the footprint', () => {
    expect(buildingFadeAlpha(6, 9, rect, 3.5, 0.35)).toBeCloseTo(0.35)
  })
  test('eases between minAlpha and 1 with distance', () => {
    const a = buildingFadeAlpha(6, 12, rect, 4, 0.35) // dist 2 of radius 4
    expect(a).toBeGreaterThan(0.35)
    expect(a).toBeLessThan(1)
  })
})
