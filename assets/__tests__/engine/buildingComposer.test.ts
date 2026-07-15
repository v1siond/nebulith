import { composeBuilding, facadeLabel, facadeLabels, rotateCells, windowColumns, BuildingType } from '@/engine/buildingComposer'
import { isWalkable } from '@/engine/cellLabels'

describe('composeBuilding — windows are aesthetic AND never absent (§1c + no-window fix)', () => {
  it('windowColumns: symmetric, spaced ≥2 apart, never empty for a real width (≥3)', () => {
    for (let len = 3; len <= 12; len++) {
      const cols = windowColumns(len)
      expect(cols.length).toBeGreaterThanOrEqual(1) // never empty
      for (let i = 1; i < cols.length; i++) expect(cols[i] - cols[i - 1]).toBeGreaterThanOrEqual(2) // ≥1 wall between, never adjacent
      if (cols.length > 1) { // spaced pairs are symmetric (a lone narrow-width window may be off-centre)
        const mirror = cols.map(c => len - 1 - c).sort((a, z) => a - z)
        expect(mirror).toEqual([...cols].sort((a, z) => a - z))
      }
    }
  })

  it('EVERY generated house/building has at least one window — no windowless houses (Image #6 regression)', () => {
    const windowless: string[] = []
    for (const type of ['house', 'big-house', 'store', 'hospital'] as const) {
      for (const floors of [1, 2, 3]) {
        for (const length of [3, 4, 5, 6, 8]) {
          const b = composeBuilding({ type, floors, length })
          if (!b.cells.flat().some(k => k === 'window')) windowless.push(`${type} f${floors} l${length}`)
        }
      }
    }
    expect(windowless).toEqual([])
  })
})

describe('composeBuilding — Nebulith building architecture spec', () => {
  it('builds the smallest legal house: 5 long × 5 tall (3 body + 2 roof)', () => {
    const b = composeBuilding({ type: 'house', floors: 1 })
    expect(b.length).toBe(5) // house footprint bumped to 5x5 for a roomy 3x3 interior
    expect(b.height).toBe(5)
    expect(b.cells).toHaveLength(5) // 5 rows (top→bottom)
    expect(b.cells[0]).toHaveLength(5) // 5 cols
  })

  it('caps the roof-top at the grass-base WIDTH (length) — a building never towers over its base', () => {
    // "the height of the building — the top roof — capped at the size of the grass base in 2D": the only
    // base dimension drawn in 2D is the footprint WIDTH (length), so total facade height <= length.
    // Floors add height only until they hit that width cap — a tall building needs a WIDE base.
    expect(composeBuilding({ type: 'hospital' }).height).toBe(6) // 6 wide, 2 floors → 8 uncapped, capped to 6
    expect(composeBuilding({ type: 'big-house' }).height).toBe(7) // 7 wide, 2 floors → 8 uncapped, capped to 7
    expect(composeBuilding({ type: 'cathedral' }).height).toBe(7) // 7 wide, 3 floors → 11 uncapped, capped to 7
    // floors DO add height when the footprint is wide enough to carry them (under the width cap):
    expect(composeBuilding({ type: 'house', floors: 3, length: 12 }).height).toBe(11) // 3*3+2, below the 12 cap
    // a narrow base can't carry extra floors — a 3-floor cottage on a 4-wide base stays at the minimum:
    expect(composeBuilding({ type: 'house', floors: 3, length: 4 }).height).toBe(5) // width-capped to the floor
  })

  it('never caps below the structural minimum (3 body + 2 roof), even on a tiny base', () => {
    expect(composeBuilding({ type: 'house', floors: 1, length: 2 }).height).toBe(5)
  })

  it('peaks the house roof (empty corners → triangle) but keeps store/building roofs flat', () => {
    const house = composeBuilding({ type: 'house', floors: 1 })
    const store = composeBuilding({ type: 'store', floors: 1 })
    expect(house.cells[0].some(c => c === 'empty')).toBe(true) // top row narrows to the apex
    expect(store.cells[0].every(c => c === 'roof')).toBe(true) // flat squared roof, full row
    expect(house.roofTop.y).toBe(0) // apex still the top-centre walkable tile
  })

  it('enforces the minimums even when smaller values are requested', () => {
    const b = composeBuilding({ type: 'house', floors: 0, length: 1 })
    expect(b.length).toBeGreaterThanOrEqual(2)
    expect(b.height).toBeGreaterThanOrEqual(5)
  })

  it('builds a 2-wide cottage (the minimum) — still legal with a door + apex', () => {
    const b = composeBuilding({ type: 'house', floors: 1, length: 2 })
    expect(b.length).toBe(2)
    expect(b.door.width).toBeGreaterThanOrEqual(1)
    expect(b.door.x + b.door.width).toBeLessThanOrEqual(b.length)
    expect(b.roofTop).toEqual({ x: 1, y: 0 })
  })

  it('a short building (<3 floors) always gets a 1-cell, 2-tall door — never a wide one (hospital excepted)', () => {
    // The wide-door "possibility" only unlocks at 3+ floors (the user's rule), so house/store/big-house
    // (1–2 floors) keep a single-cell door regardless of frontage parity. The walkable entrance + driveway
    // derive from this door rect (doorCells), so a 1-cell door still lines up (#40). HOSPITAL is the
    // exception (its own test below): it's a big civic building, so it always gets a >=2-wide entrance.
    for (const type of ['house', 'store', 'big-house'] as BuildingType[]) {
      const b = composeBuilding({ type, floors: 1, wideDoor: true }) // even with the roll ON, floors gate it
      expect(b.door.height).toBe(2) // a 2-tall doorway, not a window
      expect(b.door.width).toBe(1) // <3 floors → never wide
      const bottom = b.height - 1
      expect(b.cells[bottom][b.door.x]).toBe('door') // ground row of the door
      expect(b.cells[bottom - 1][b.door.x]).toBe('door') // second (top) row of the door
      expect(b.door.x).toBeGreaterThan(0) // a wall column survives to the left
      expect(b.door.x + b.door.width).toBeLessThanOrEqual(b.length)
    }
  })

  it('a HOSPITAL always gets at least a 2×2 entrance (2 wide × 2 tall) — a big civic doorway', () => {
    // "considering hospital are big, their entrance should always be at least 2x2." The 2×2 = doorWidth>=2
    // (wide) × DOOR_HEIGHT (2 tall), regardless of floor count. A wall column still survives each side, and
    // the drawn door SPAN covers the walkable entrance column so collision + the drawn door stay aligned.
    for (const floors of [1, 2, 3]) {
      const b = composeBuilding({ type: 'hospital', floors })
      expect(b.door.width).toBeGreaterThanOrEqual(2) // at least 2 WIDE
      expect(b.door.height).toBe(2) // 2 TALL (DOOR_HEIGHT)
      const bottom = b.height - 1
      for (let c = b.door.x; c < b.door.x + b.door.width; c++) {
        expect(b.cells[bottom][c]).toBe('door') // ground row of the door, full width
        expect(b.cells[bottom - 1][c]).toBe('door') // second (top) row — 2 tall
      }
      expect(b.door.x).toBeGreaterThan(0) // a wall column survives to the left
      expect(b.door.x + b.door.width).toBeLessThanOrEqual(b.length) // …and to the right
      const mid = Math.floor(b.length / 2) // the walkable entrance column (doorCellFor uses floor(w/2))
      expect(mid).toBeGreaterThanOrEqual(b.door.x)
      expect(mid).toBeLessThan(b.door.x + b.door.width) // the drawn door covers the walkable entrance
    }
  })

  it('unlocks a 2-wide centred door ONLY for a 3+ floor even-width building when the roll allows it', () => {
    // eligible (3 floors, even width) + roll ON → 2 wide + centred (symmetric with the mirrored windows)
    const wide = composeBuilding({ type: 'house', floors: 3, length: 6, wideDoor: true })
    expect(wide.door.width).toBe(2)
    expect(2 * wide.door.x + wide.door.width).toBe(wide.length) // equal margins ⇒ centred/symmetric
    // same building, roll OFF → stays 1 wide (a possibility, not automatic)
    expect(composeBuilding({ type: 'house', floors: 3, length: 6, wideDoor: false }).door.width).toBe(1)
    // <3 floors, even, roll ON → still 1 (the floor gate wins)
    expect(composeBuilding({ type: 'house', floors: 2, length: 6, wideDoor: true }).door.width).toBe(1)
    // odd width, 3 floors, roll ON → 1 (a single cell already centres cleanly on odd)
    expect(composeBuilding({ type: 'house', floors: 3, length: 5, wideDoor: true }).door.width).toBe(1)
  })

  it('centres the drawn door SPAN on the walkable entrance column floor(length/2) for EVERY length + type', () => {
    // #A: the walkable doorCell (collision) + driveway sit on floor(length/2); the DRAWN facade door must
    // COVER that column or it lands off the entrance the collision opened. The old `floor((L-doorWidth)/2)`
    // left a 1-wide door on an EVEN frontage one column LEFT of floor(L/2) — the "door not at entrance" bug.
    const types: BuildingType[] = ['house', 'store', 'hospital', 'big-house', 'cathedral', 'temple', 'castle']
    for (const type of types) {
      for (const length of [2, 3, 4, 5, 6, 7, 8]) {
        const b = composeBuilding({ type, length })
        const mid = Math.floor(b.length / 2) // the walkable entrance column (doorCellFor uses floor(w/2))
        expect(mid).toBeGreaterThanOrEqual(b.door.x)
        expect(mid).toBeLessThan(b.door.x + b.door.width) // the drawn door SPAN covers the walkable column
        expect(b.cells[b.height - 1][mid]).toBe('door')   // …and the bottom-row cell there really IS drawn a door
      }
    }
  })

  it('roofs the top row (flat store) and walls the body (corners are walls, not door)', () => {
    const b = composeBuilding({ type: 'store', floors: 1 }) // flat roof → full top row
    expect(b.cells[0].every(c => c === 'roof')).toBe(true)
    expect(b.cells[b.height - 1][0]).toBe('wall')
  })

  it('sizes larger structures bigger than a house but still legal', () => {
    const castle = composeBuilding({ type: 'castle' })
    const house = composeBuilding({ type: 'house' })
    expect(castle.length).toBeGreaterThan(house.length)
    expect(castle.height).toBeGreaterThanOrEqual(4)
    expect(castle.door.width).toBeGreaterThanOrEqual(2)
  })

  it('marks the apex (top-center) as the single roofTop cell', () => {
    const b = composeBuilding({ type: 'house', floors: 1 })
    expect(b.roofTop.y).toBe(0) // top row
    expect(b.roofTop.x).toBe(Math.floor(b.length / 2)) // centered
    expect(b.cells[b.roofTop.y][b.roofTop.x]).toBe('roof') // apex is a roof cell
  })

  // The 2D renderer paints ONE tile per facade cell, red on roof cells. So the red roof is
  // exactly as many rows as the facade has roof rows — which must always be 2, on the TOP,
  // never more, no matter how many floors. This guards the invariant the render relies on.
  it('keeps roof to EXACTLY 2 rows (top of the facade) across every type + floor count', () => {
    const types: BuildingType[] = ['house', 'big-house', 'store', 'hospital', 'cathedral', 'temple', 'castle']
    for (const type of types) {
      for (const floors of [1, 2, 3, 5]) {
        const b = composeBuilding({ type, floors })
        expect(b.cells.filter(row => row.some(c => c === 'roof')).length).toBe(2)
        for (let r = 2; r < b.height; r++) expect(b.cells[r].every(c => c !== 'roof')).toBe(true)
      }
    }
  })
})

describe('facadeLabels — facade-cell → CellLabel mapping (the keystone)', () => {
  it('labels exactly ONE cell roof_top (the walkable apex), all others non-roof_top', () => {
    const b = composeBuilding({ type: 'house', floors: 2 })
    const labels = facadeLabels(b).flat()
    const roofTops = labels.filter(l => l === 'roof_top')
    expect(roofTops).toHaveLength(1)
    expect(facadeLabel(b, b.roofTop.x, b.roofTop.y)).toBe('roof_top')
  })

  it('maps every facade kind to its part label (roof body, wall, door, window)', () => {
    const b = composeBuilding({ type: 'store', floors: 1 }) // flat roof → full top row to check
    const labels = facadeLabels(b)
    // top row: apex is roof_top, the rest of the roof row is plain roof
    for (let col = 0; col < b.length; col++) {
      const expected = col === b.roofTop.x ? 'roof_top' : 'roof'
      expect(labels[0][col]).toBe(expected)
    }
    // door band (bottom rows) carries 'door'; corners of the bottom row are walls
    const bottom = b.height - 1
    expect(labels[bottom][b.door.x]).toBe('door')
    expect(labels[bottom][0]).toBe('wall')
    // a window exists somewhere on a body row
    expect(labels.flat()).toContain('window')
  })

  it('per-label collision: ONLY roof_top + doors are walkable, walls/roof/windows block', () => {
    const b = composeBuilding({ type: 'temple' })
    const labels = facadeLabels(b).flat().filter((l): l is NonNullable<typeof l> => l !== null)
    const walkable = labels.filter(l => isWalkable(l))
    // exactly one roof_top among the walkable cells; the rest are doors
    expect(walkable.filter(l => l === 'roof_top')).toHaveLength(1)
    expect(walkable.every(l => l === 'roof_top' || l === 'door')).toBe(true)
    // walls, roof body, windows all block
    expect(labels.filter(l => l === 'wall').every(l => !isWalkable(l))).toBe(true)
    expect(labels.filter(l => l === 'roof').every(l => !isWalkable(l))).toBe(true)
    expect(labels.filter(l => l === 'window').every(l => !isWalkable(l))).toBe(true)
  })
})

describe('rotateCells — pure 90° turns put the door on the right road-facing edge', () => {
  // A 2-row × 3-col grid; 'D' (door) sits on the BOTTOM-centre, like a real facade.
  //   . . .
  //   . D .
  const grid = [
    ['a', 'b', 'c'],
    ['d', 'D', 'f'],
  ]
  const doorAt = (cells: string[][]): { r: number; c: number } => {
    for (let r = 0; r < cells.length; r++) {
      const c = cells[r].indexOf('D')
      if (c !== -1) return { r, c }
    }
    throw new Error('door not found')
  }

  it('0 turns leaves the grid unchanged (south → door bottom)', () => {
    expect(rotateCells(grid, 0)).toEqual(grid)
  })

  it('1 turn (CW) is a correct 90° clockwise rotation → door on the LEFT edge (west)', () => {
    const out = rotateCells(grid, 1)
    expect(out).toEqual([
      ['d', 'a'],
      ['D', 'b'],
      ['f', 'c'],
    ])
    expect(doorAt(out).c).toBe(0) // leftmost column
  })

  it('2 turns (180°) flips the grid → door on the TOP edge (north)', () => {
    const out = rotateCells(grid, 2)
    expect(out).toEqual([
      ['f', 'D', 'd'],
      ['c', 'b', 'a'],
    ])
    expect(doorAt(out).r).toBe(0) // top row
  })

  it('3 turns (CCW equiv) → door on the RIGHT edge (east)', () => {
    const out = rotateCells(grid, 3)
    expect(out).toEqual([
      ['c', 'f'],
      ['b', 'D'],
      ['a', 'd'],
    ])
    expect(doorAt(out).c).toBe(out[0].length - 1) // rightmost column
  })

  it('wraps rotation count (4 → identity, negative turns CW the other way)', () => {
    expect(rotateCells(grid, 4)).toEqual(grid)
    expect(rotateCells(grid, -1)).toEqual(rotateCells(grid, 3))
  })

  it('is pure — never mutates the input grid', () => {
    const original = grid.map(row => [...row])
    rotateCells(grid, 3)
    expect(grid).toEqual(original)
  })
})
