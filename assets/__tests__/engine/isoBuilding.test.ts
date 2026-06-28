import { isoFacingIndex, isoFacadeOnBack } from '../../engine/isoBuilding'

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
