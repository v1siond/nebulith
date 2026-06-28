import { isoFacingIndex } from '../../engine/isoBuilding'

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
