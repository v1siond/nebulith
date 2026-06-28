import { generateStage } from '@/engine/stageGenerator'
import { planVillage, type Plot } from '@/engine/villageLayout'
import { composeBuilding } from '@/engine/buildingComposer'

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
function genWithSeed(settlement: 'village' | 'town' | 'city', seed: number) {
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
  for (const settlement of ['village', 'town', 'city'] as const) {
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

      // (b) Every ACTUALLY-stamped building cell sits off the roads (the small footprint never
      //     spills onto the street it fronts).
      const buildingCells = stage.props.filter(p => p.type === 'building')
      expect(buildingCells.length).toBeGreaterThan(0)
      for (const cell of buildingCells) {
        expect(cell.row).toBeGreaterThanOrEqual(0)
        expect(cell.col).toBeGreaterThanOrEqual(0)
        expect(cell.row).toBeLessThan(ROWS)
        expect(cell.col).toBeLessThan(COLS)
        expect(layout.roads[cell.row][cell.col]).toBe(false)
      }

      // (c) STRONGER: collision == the small width×depth footprint. Every footprint cell BLOCKS
      //     except the single walkable door, and the footprint depth is the composer's small depth.
      for (const b of stage.buildings) {
        const depth = composeBuilding({ type: b.type, length: b.facade.length }).depth
        const horizontal = b.facing === 'south' || b.facing === 'north'
        expect(horizontal ? b.height : b.length).toBe(depth) // grid row/col-span perpendicular = depth
        const top = b.row - (b.height - 1)
        let blocked = 0
        for (let r = top; r <= b.row; r++) {
          for (let c = b.col; c < b.col + b.length; c++) if (stage.collision[r][c]) blocked++
        }
        expect(b.doorCells).toHaveLength(1)
        const d = b.doorCells[0]
        expect(stage.collision[d.row][d.col]).toBe(false) // door walkable
        expect(blocked).toBe(b.length * b.height - 1) // every other footprint cell blocks
      }
    })
  }

  test('every building door faces a road within the setback (a road within 2 cells of the door)', () => {
    for (const settlement of ['village', 'town', 'city'] as const) {
      for (const seed of [12345, 777, 42]) {
        const { stage, layout } = genWithSeed(settlement, seed)
        const isRoad = (c: number, r: number): boolean => layout.roads[r]?.[c] === true

        expect(stage.buildings.length).toBeGreaterThan(0)
        for (const b of stage.buildings) {
          expect(b.doorCells).toHaveLength(1)
          const d = b.doorCells[0]
          // door is set back: a road is within 2 cells (the setback yard + the street), not on the door.
          expect(isRoad(d.col, d.row)).toBe(false)
          const near = ORTHO.some(([dc, dr]) => isRoad(d.col + dc, d.row + dr) || isRoad(d.col + 2 * dc, d.row + 2 * dr))
          expect(near).toBe(true)
        }
      }
    }
  })
})
