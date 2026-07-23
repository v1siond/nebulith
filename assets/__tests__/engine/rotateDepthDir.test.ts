/**
 * rotateDepthDir — rotate a directional-DEPTH direction by CW quarter-turns, the SAME way rotateFootprintOffset
 * rotates a composition cell's grid offset. A roof column is authored spanning the +row (south, `left-down`)
 * axis; when a building is rotated to face east/west/north the roof's span must rotate WITH the footprint, or an
 * east/west building gets a sideways roof. The mapping is DERIVED from DEPTH_CELL_STEP: a CW quarter-turn sends
 * the grid step (dc,dr) → (-dr,dc), so this test pins the derivation, the 4-cycle, and the roof-facing cases.
 */
import { rotateDepthDir, DEPTH_CELL_STEP, type DepthDir } from '@/engine/render/isoBlock'

const DIRS: DepthDir[] = ['right-up', 'left-up', 'left-down', 'right-down']

describe('rotateDepthDir — CW quarter-turns on a depth direction (matches rotateFootprintOffset)', () => {
  test('rotation 0 is the identity for every direction', () => {
    for (const d of DIRS) expect(rotateDepthDir(d, 0)).toBe(d)
  })

  test('one CW quarter-turn maps each dir per the grid rotation (dc,dr) → (-dr,dc)', () => {
    for (const d of DIRS) {
      const { dc, dr } = DEPTH_CELL_STEP[d]
      const expected = DIRS.find(x => DEPTH_CELL_STEP[x].dc === -dr && DEPTH_CELL_STEP[x].dr === dc)!
      expect(rotateDepthDir(d, 1)).toBe(expected)
    }
  })

  test('the explicit CW cycle: right-up → right-down → left-down → left-up → right-up', () => {
    expect(rotateDepthDir('right-up', 1)).toBe('right-down')
    expect(rotateDepthDir('right-down', 1)).toBe('left-down')
    expect(rotateDepthDir('left-down', 1)).toBe('left-up')
    expect(rotateDepthDir('left-up', 1)).toBe('right-up')
  })

  test('four quarter-turns return to the start; rotation wraps mod 4 and accepts negatives', () => {
    for (const d of DIRS) {
      expect(rotateDepthDir(d, 4)).toBe(d)
      expect(rotateDepthDir(d, 8)).toBe(d)
      expect(rotateDepthDir(d, 2)).toBe(rotateDepthDir(rotateDepthDir(d, 1), 1))
      expect(rotateDepthDir(d, 3)).toBe(rotateDepthDir(d, -1))
    }
  })

  test('the south-authored roof span (left-down = +row) follows facingRotation to the right axis', () => {
    // facingRotation: south=0, west=1, north=2, east=3. The roof span must track the footprint so an
    // east/west building never gets a sideways roof.
    expect(rotateDepthDir('left-down', 0)).toBe('left-down') // south: +row
    expect(rotateDepthDir('left-down', 1)).toBe('left-up') //  west:  −col
    expect(rotateDepthDir('left-down', 2)).toBe('right-up') // north:  −row
    expect(rotateDepthDir('left-down', 3)).toBe('right-down') // east: +col
  })
})
