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

// The oriented footprint rect of a plot — south/north run length×height (cols×rows); east/west
// swap to height×length. Mirrors villageLayout's `footprint`.
function plotRect(p: Plot): { c0: number; r0: number; w: number; h: number } {
  const H = composeBuilding({ type: p.type, length: p.length }).height
  const horizontal = p.facing === 'south' || p.facing === 'north'
  return { c0: p.col, r0: p.row, w: horizontal ? p.length : H, h: horizontal ? H : p.length }
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

      // (b) The CONSUMER bug: stamping `height-1` rows too high lands building cells ON a road or
      //     off their footprint. Assert every ACTUALLY-stamped building cell sits off the roads.
      const buildingCells = stage.props.filter(p => p.type === 'building')
      expect(buildingCells.length).toBeGreaterThan(0)
      for (const cell of buildingCells) {
        expect(cell.row).toBeGreaterThanOrEqual(0)
        expect(cell.col).toBeGreaterThanOrEqual(0)
        expect(cell.row).toBeLessThan(ROWS)
        expect(cell.col).toBeLessThan(COLS)
        expect(layout.roads[cell.row][cell.col]).toBe(false)
      }
    })
  }

  test('every building has at least one door cell adjacent to a road (all facings reach a street)', () => {
    for (const settlement of ['village', 'town', 'city'] as const) {
      for (const seed of [12345, 777, 42]) {
        const { stage, layout } = genWithSeed(settlement, seed)
        const isRoad = (c: number, r: number): boolean => layout.roads[r]?.[c] === true

        expect(stage.buildings.length).toBeGreaterThan(0)
        for (const b of stage.buildings) {
          expect(b.doorCells.length).toBeGreaterThan(0)
          const reachable = b.doorCells.some(d => ORTHO.some(([dc, dr]) => isRoad(d.col + dc, d.row + dr)))
          expect(reachable).toBe(true)
        }
      }
    }
  })
})
