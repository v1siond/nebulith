/**
 * A STREET IS A PATHWAY, SO A TOWN HAS AS MANY STREETS AS IT HAS PATHWAYS.
 *
 * *"I created a town with 2 exit and 2 pathways, but it generated a town with 2 exit (good) and 6 pathways,
 * even when I specified 2, for a small town … pathways size must apply to the streets distribution logic, in
 * fact, they're rendundant, street is just a form of pathway"* (2026-09-14, on his 40x40 town).
 *
 * The backend had already settled it: a settlement's "Streets" dropdown is the `pathways` key under a
 * different label (`generator_source.ex`, `@settlement_way_options`). One concept, one served number. The
 * planner disagreed on its own: `planRoads` read a fixed `GRID` (town 3 by 3, city 5 by 6) and laid that many
 * whatever was asked, so his 2 came out as 3 across plus 3 down. Measured here before the fix and after.
 *
 * The same shape as `houseWidths` and `natureMultiplier` before it: the served value arrived, and a local
 * constant in the frontend won.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { planVillage, streetRoom, type BuildingSizes, type StreetPlan, type VillageLayout } from '@/engine/villageLayout'
import { planRoutes, resolveWays, type Side } from '@/engine/pathNetwork'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

/** Footprints stand in for the backend's, so the planner has sizes to place and the test never depends on
 *  which building compositions happen to be seeded. */
const SIZES: BuildingSizes = {
  depthOf: () => 3,
  lengthOf: () => 4,
  defaultOf: () => ({ w: 4, h: 3 }),
}

/** How many streets a plan actually has: a maximal run of FULL-SPAN road rows is one street across, a run of
 *  full-span road columns is one street down. Exactly what you count looking at the map. */
function streetCount(layout: VillageLayout, cols: number, rows: number): { across: number; down: number } {
  const fullRow = (r: number): boolean => layout.roads[r].every(Boolean)
  const fullCol = (c: number): boolean => layout.roads.every(row => row[c])
  let across = 0, down = 0
  for (let r = 0; r < rows; r++) if (fullRow(r) && !(r > 0 && fullRow(r - 1))) across++
  for (let c = 0; c < cols; c++) if (fullCol(c) && !(c > 0 && fullCol(c - 1))) down++
  return { across, down }
}

/** The street plan a settlement inherits, built the way `streetPlanFor` builds it in the generator: real
 *  served options through `resolveWays`, real gates through `planRoutes`. */
function planFor(cols: number, rows: number, exits: number, pathways: number, seed: number): StreetPlan {
  const rand = makeRng(seed)
  const ways = resolveWays({ exits: String(exits), pathways: String(pathways) }, rand, { cols, rows, width: 3 }, streetRoom(cols, rows))!
  const routes = planRoutes(cols, rows, ways, rand, 3)
  const line = (side: Side, cells: { col: number; row: number }[]): number => {
    const mid = cells[Math.floor(cells.length / 2)]
    return side === 'west' || side === 'east' ? mid.row : mid.col
  }
  return { pathways: ways.pathways, gates: routes.gates.map(g => ({ side: g.side, at: line(g.side, g.cells) })) }
}

describe('a settlement lays one street per pathway', () => {
  // His own case, first and by name.
  it('gives his 40x40 town 2 streets when he asks for 2, not 6', () => {
    const plan = planFor(40, 40, 2, 2, 7)
    expect(plan.pathways).toBe(2)
    const layout = planVillage(40, 40, makeRng(7), SIZES, 'town', undefined, plan)
    const { across, down } = streetCount(layout, 40, 40)
    expect(across + down).toBe(2)
  })

  it('laid 6 for that same town before the fix, which is what the fixed GRID decided', () => {
    // No plan handed in is the old behaviour exactly, kept for a generator that serves no ways.
    const layout = planVillage(40, 40, makeRng(7), SIZES, 'town')
    const { across, down } = streetCount(layout, 40, 40)
    expect(across + down).toBe(6)
  })

  it.each([1, 2, 3, 4, 5, 6])('lays %i street(s) on a 40x40 town, exactly', pathways => {
    const plan = planFor(40, 40, 2, pathways, 3)
    const layout = planVillage(40, 40, makeRng(3), SIZES, 'town', undefined, plan)
    const { across, down } = streetCount(layout, 40, 40)
    expect(across + down).toBe(plan.pathways)
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('lays %i street(s) on a 60x48 city, exactly', pathways => {
    const plan = planFor(60, 48, 4, pathways, 11)
    const layout = planVillage(60, 48, makeRng(11), SIZES, 'city', undefined, plan)
    const { across, down } = streetCount(layout, 60, 48)
    expect(across + down).toBe(plan.pathways)
  })

  it('never lays more streets than the map can hold blocks between', () => {
    // 8 streets asked of a small map. The ceiling is measured, not decreed, so the ask is held rather than
    // producing streets with nothing between them.
    const plan = planFor(30, 24, 2, 8, 5)
    const layout = planVillage(30, 24, makeRng(5), SIZES, 'town', undefined, plan)
    const { across, down } = streetCount(layout, 30, 24)
    expect(across + down).toBeLessThanOrEqual(4)
    expect(across + down).toBe(plan.pathways)
  })

  it('grows as a grid, not as parallel roads: 4 streets are 2 across and 2 down', () => {
    const plan = planFor(40, 40, 2, 4, 9)
    const layout = planVillage(40, 40, makeRng(9), SIZES, 'town', undefined, plan)
    const { across, down } = streetCount(layout, 40, 40)
    expect(Math.abs(across - down)).toBeLessThanOrEqual(1)
  })
})

describe('the gates sit ON the streets', () => {
  it.each([2, 3, 4])('puts a street through every one of the %i gates it planned', exits => {
    const plan = planFor(40, 40, exits, 4, 13)
    const layout = planVillage(40, 40, makeRng(13), SIZES, 'town', undefined, plan)
    for (const gate of plan.gates) {
      // A gate on the left or right edge is met by a road running across at its row; one on the top or bottom
      // by a road running down at its column. Either way the gate's own line is paved.
      const paved = gate.side === 'west' || gate.side === 'east'
        ? layout.roads[gate.at]?.some(Boolean)
        : layout.roads.some(row => row[gate.at])
      expect(paved).toBe(true)
    }
  })
})

/** Roads are the only thing a settlement paints into `floorColors`, so a row of them is a street you can see. */
function paintedStreets(stage: StageData): number {
  const { floorColors, cols, rows } = stage
  const fullRow = (r: number): boolean => floorColors[r].every(v => v !== undefined)
  const fullCol = (c: number): boolean => floorColors.every(row => row[c] !== undefined)
  let count = 0
  for (let r = 0; r < rows; r++) if (fullRow(r) && !(r > 0 && fullRow(r - 1))) count++
  for (let c = 0; c < cols; c++) if (fullCol(c) && !(c > 0 && fullCol(c - 1))) count++
  return count
}

describe('the whole chain, through the real generator', () => {
  const build = (variant: 'town' | 'city', exits: number, pathways: number, seed: number): StageData => {
    const config = findGenerator(CATALOG, 'settlement', variant)?.config
    expect(config).toBeDefined()
    const orig = Math.random
    Math.random = makeRng(seed)
    try {
      return generateStage({
        zone: 'spring', variant, layout: variant as never, cols: 40, rows: 40,
        options: { exits: String(exits), pathways: String(pathways) },
        nature: config?.nature, palette: config?.palette, settlement: config?.settlement,
        formation: config?.formation, treeMix: config?.trees, subZones: config?.subZones,
      })
    } finally { Math.random = orig }
  }

  it.each([1, 2, 3, 4])('a generated town asked for %i street(s) paints that many', pathways => {
    expect(paintedStreets(build('town', 2, pathways, 21))).toBe(pathways)
  })

  it('a generated city asked for 6 streets paints 6', () => {
    expect(paintedStreets(build('city', 4, 6, 21))).toBe(6)
  })
})
