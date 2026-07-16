import { generateStage, treeColumnClearsPaving, doorCells } from '@/engine/stageGenerator'
import { planVillage, type Plot } from '@/engine/villageLayout'
import { BUILDING_DEPTH } from '@/engine/buildingCatalog'

// A deterministic LCG so the same seed reproduces the SAME layout in both the generator (via the
// Math.random stub) and the standalone planVillage call we assert against.
function seeded(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

// The oriented GROUND footprint rect of a plot — south/north run length×DEPTH (cols×rows); east/west
// swap to depth×length. Mirrors villageLayout's `footprint` — the small ground depth, not the facade.
function plotRect(p: Plot): { c0: number; r0: number; w: number; h: number } {
  const horizontal = p.facing === 'south' || p.facing === 'north'
  return { c0: p.col, r0: p.row, w: horizontal ? p.length : p.depth, h: horizontal ? p.depth : p.length }
}

const ORTHO: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const COLS = 48
const ROWS = 48

// Run the generator with a seeded Math.random, then reproduce the EXACT layout the generator used
// (planVillage is the first Math.random consumer in generateStage and is pure given its rng).
function genWithSeed(settlement: 'town' | 'city', seed: number) {
  const realRandom = Math.random
  Math.random = seeded(seed)
  try {
    const stage = generateStage({ zone: 'spring', variant: settlement, cols: COLS, rows: ROWS })
    const layout = planVillage(COLS, ROWS, seeded(seed), settlement)
    return { stage, layout }
  } finally {
    Math.random = realRandom
  }
}

describe('settlement building placement (consumer matches planner contract)', () => {
  for (const settlement of ['town', 'city'] as const) {
    test(`${settlement}: every footprint cell is in bounds and OFF the roads`, () => {
      const { stage, layout } = genWithSeed(settlement, 12345)
      expect(layout.plots.length).toBeGreaterThan(0)

      // (a) Every PLANNED footprint cell stays in bounds and off the carved streets.
      for (const plot of layout.plots) {
        const f = plotRect(plot)
        for (let r = f.r0; r < f.r0 + f.h; r++) {
          for (let c = f.c0; c < f.c0 + f.w; c++) {
            expect(r).toBeGreaterThanOrEqual(0)
            expect(c).toBeGreaterThanOrEqual(0)
            expect(r).toBeLessThan(ROWS)
            expect(c).toBeLessThan(COLS)
            expect(layout.roads[r][c]).toBe(false)
          }
        }
      }

      // (b) Every ACTUALLY-stamped building sits off the roads (the small footprint never spills onto the
      //     street it fronts) — checked over the footprint rect from stage.buildings (no flat props now).
      expect(stage.buildings.length).toBeGreaterThan(0)
      for (const b of stage.buildings) {
        const top = b.row - (b.height - 1)
        for (let r = top; r <= b.row; r++) {
          for (let c = b.col; c < b.col + b.length; c++) {
            expect(r).toBeGreaterThanOrEqual(0)
            expect(c).toBeGreaterThanOrEqual(0)
            expect(r).toBeLessThan(ROWS)
            expect(c).toBeLessThan(COLS)
            expect(layout.roads[r][c]).toBe(false)
          }
        }
      }

      // (c) STRONGER: collision == the small width×depth footprint. Every footprint cell BLOCKS except the
      //     single walkable door, and the footprint depth is the composition's baked (small) depth.
      for (const b of stage.buildings) {
        const horizontal = b.facing === 'south' || b.facing === 'north'
        expect(horizontal ? b.height : b.length).toBe(BUILDING_DEPTH[b.type]) // perpendicular span = depth
        const top = b.row - (b.height - 1)
        let blocked = 0
        for (let r = top; r <= b.row; r++) {
          for (let c = b.col; c < b.col + b.length; c++) if (stage.collision[r][c]) blocked++
        }
        expect(b.doorCells).toHaveLength(1) // every baked composition has ONE door
        for (const d of b.doorCells) expect(stage.collision[d.row][d.col]).toBe(false) // the door cell is walkable
        expect(blocked).toBe(b.length * b.height - b.doorCells.length) // every NON-door footprint cell blocks
      }
    })
  }

  test('the town SQUARE is reserved CENTRALLY before houses, and is ONE fountain (never N props)', () => {
    for (const settlement of ['town', 'city'] as const) {
      let sawFountain = false
      for (const seed of [12345, 777, 42, 1, 2, 3, 7, 99]) {
        const { stage, layout } = genWithSeed(settlement, seed)
        const plaza = layout.plaza
        expect(plaza).not.toBeNull()
        if (!plaza) continue

        // (a) reserved CENTRALLY — the square sits near the map centre (a town square, not wherever-fits).
        const pcx = plaza.c0 + plaza.size / 2
        const pcy = plaza.r0 + plaza.size / 2
        expect(Math.abs(pcx - COLS / 2)).toBeLessThanOrEqual(COLS * 0.3)
        expect(Math.abs(pcy - ROWS / 2)).toBeLessThanOrEqual(ROWS * 0.3)

        // (b) NO building footprint cell lands on the reserved square (houses built AROUND it).
        for (const b of stage.buildings) {
          const top = b.row - (b.height - 1)
          for (let r = top; r <= b.row; r++) {
            for (let c = b.col; c < b.col + b.length; c++) {
              const inPlaza = c >= plaza.c0 && c < plaza.c0 + plaza.size && r >= plaza.r0 && r < plaza.r0 + plaza.size
              expect(inPlaza).toBe(false)
            }
          }
        }

        // (c) the plain WELL is dropped, and the centrepiece is ONE structure — at most a single
        //     fountain prop (never a cluster of N per-cell props).
        const wells = stage.props.filter(p => p.type === 'well')
        const fountains = stage.props.filter(p => p.type === 'fountain')
        expect(wells).toHaveLength(0)
        expect(fountains.length).toBeLessThanOrEqual(1)

        // (d) when it's a fountain (the common case), it's ONE prop centred on the square, carrying
        //     the basin span, and every basin cell BLOCKS (you walk the paved ring around it).
        if (fountains.length === 1) {
          sawFountain = true
          const fountain = fountains[0]
          expect(fountain.footprint).toBeGreaterThanOrEqual(3)
          const basin = plaza.size >= 7 ? 5 : 3
          expect(fountain.footprint).toBe(basin)
          const bc = plaza.c0 + Math.floor((plaza.size - basin) / 2)
          const br = plaza.r0 + Math.floor((plaza.size - basin) / 2)
          expect(fountain.col).toBe(bc + Math.floor(basin / 2))
          expect(fountain.row).toBe(br + Math.floor(basin / 2))
          for (let r = br; r < br + basin; r++)
            for (let c = bc; c < bc + basin; c++) expect(stage.collision[r][c]).toBe(true)
        }
      }
      expect(sawFountain).toBe(true) // the fountain (not the rare pond) is the dominant centrepiece
    }
  })

  // A tree occupies only its TRUNK cell (the canopy stacks in levels ABOVE it and is walkable overhead), so
  // paving clearance checks just that one cell — a tree never lands its trunk on the stone plaza / a road, the
  // "trees weirdly in the centre, not on grass" bug. A merely-adjacent paved cell is fine (canopy is overhead).
  test('treeColumnClearsPaving rejects a trunk cell on paving (canopy is walkable overhead)', () => {
    const grass = (): string[][] => Array.from({ length: 6 }, () => ['grass', 'grass', 'grass'])
    expect(treeColumnClearsPaving(grass(), 1, 5)).toBe(true) // grass → fits
    const trunkPaved = grass(); trunkPaved[5][1] = 'path_stone'
    expect(treeColumnClearsPaving(trunkPaved, 1, 5)).toBe(false) // trunk on the plaza → rejected
    const neighborPaved = grass(); neighborPaved[5][2] = 'path_stone' // an ADJACENT cell paved (only overhead canopy reaches it)
    expect(treeColumnClearsPaving(neighborPaved, 1, 5)).toBe(true) // trunk on grass, neighbour paved → still fits
  })

  // The DRAWN door is `door.width` cells wide (2 on even frontages, #49) but only 1 collision cell used to
  // open — so a 2-wide door had a walkable half and a blocked half: you could "walk between two tiles" but
  // not stand on the actual entrance. The walkable opening must match the drawn door.
  test('doorCells: an axis-aligned entrance spans the full door width; a rotated one stays 1 cell', () => {
    const rect = { col: 10, row: 20, w: 6, h: 4 }
    // south: door at facade x=2, width=2 → the two middle cells of the bottom edge (row 23), cols 12 & 13.
    expect(doorCells('south', rect, { x: 2, width: 2 })).toEqual([{ col: 12, row: 23 }, { col: 13, row: 23 }])
    // north: same span on the TOP edge (row 20).
    expect(doorCells('north', rect, { x: 2, width: 2 })).toEqual([{ col: 12, row: 20 }, { col: 13, row: 20 }])
    // east/west (rotated): the 2D facade collapses the door to ONE edge cell, so the opening stays 1 cell.
    expect(doorCells('east', rect, { x: 2, width: 2 })).toEqual([{ col: 15, row: 22 }])
    expect(doorCells('west', rect, { x: 2, width: 2 })).toEqual([{ col: 10, row: 22 }])
  })

  test('every building opens exactly ONE walkable door on its road-facing edge', () => {
    for (const seed of [12345, 777, 42, 1, 2, 3]) {
      const { stage } = genWithSeed('town', seed)
      const axisBuildings = stage.buildings.filter(b => b.facing === 'south' || b.facing === 'north')
      expect(axisBuildings.length).toBeGreaterThan(0)
      for (const b of axisBuildings) {
        expect(b.doorCells).toHaveLength(1) // one door per baked composition
        for (const d of b.doorCells) expect(stage.collision[d.row][d.col]).toBe(false) // the door is walkable
      }
    }
  })

  test('town: every tree anchor stands on GRASS — never on the paved plaza or roads', () => {
    const GRASS = new Set(['grass', 'grass_tall'])
    for (const seed of [12345, 777, 42, 1, 2, 3, 7, 99]) {
      const { stage } = genWithSeed('town', seed)
      expect(stage.trees.length).toBeGreaterThan(0) // a spring town is leafy
      for (const t of stage.trees) {
        // the trunk stands on grass, and treeColumnClearsPaving kept the whole 3-wide footprint off the paving
        expect(GRASS.has(stage.ground[t.row][t.col])).toBe(true)
      }
    }
  })

  test('every building door faces a road within the setback (a road within 2 cells of the door)', () => {
    for (const settlement of ['town', 'city'] as const) {
      for (const seed of [12345, 777, 42]) {
        const { stage, layout } = genWithSeed(settlement, seed)
        const isRoad = (c: number, r: number): boolean => layout.roads[r]?.[c] === true

        expect(stage.buildings.length).toBeGreaterThan(0)
        for (const b of stage.buildings) {
          expect(b.doorCells.length).toBeGreaterThanOrEqual(1)
          for (const d of b.doorCells) {
            // every door cell is set back: a road is within 2 cells (setback yard + street), not on the door.
            expect(isRoad(d.col, d.row)).toBe(false)
            const near = ORTHO.some(([dc, dr]) => isRoad(d.col + dc, d.row + dr) || isRoad(d.col + 2 * dc, d.row + 2 * dr))
            expect(near).toBe(true)
          }
        }
      }
    }
  })
})
