import '@/__tests__/helpers/installTilesetSeed' // the generator reads all tile/composition data from the fixture
import { generateStage, type NatureDensity, type StageData } from '@/engine/stageGenerator'
import { applyStageToGrid } from '@/game/editor/applyStage'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { exitConnectors } from '@/game/editor/connectors'
import { makeRng } from '@/lib/math'

/**
 * AN EXIT IS THE FULL SERVED WIDTH, IT IS ONLY THAT WIDTH, AND NOTHING STANDS IN IT. PATHWAYS.md §3 and §4.
 *
 * The reported picture was a five-cell opening with a tree on the first and last cell of it. The cause was
 * TWO WIDTHS for one thing: `gateOn` cuts the gate at the SERVED `pathwayWidth`, while the dressing pass
 * painted its lane off a `GATEWAY_HALF` constant of 2, so every way out was drawn 5 cells across whatever the
 * template served. Everything that guards a way out, the claim, `sealMapEdge`'s spare list, the connectors,
 * works off the gate, so the extra paved cells were unguarded ground in plain sight and the border treeline
 * planted straight into them.
 *
 * SO THE WIDTH IS ASSERTED, NOT ONLY THE EMPTINESS. A test that only asks "is the gate clear" passes on the
 * broken map, because the gate WAS clear: the trees stood on the paved cells beside it.
 *
 * AND THE OPTIONS ARE SERVED. `resolvePathways` returns null unless `exits` or `pathways` is stated, so a
 * build without them plans no routes at all. The previous version of this file omitted them and guarded every
 * case with `if (!stage.routes) continue`, which meant twenty-four green cases asserting nothing whatsoever.
 * `routes` is now required of every build, so a silent plan failure fails the test instead of skipping it.
 */
const NATURE: NatureDensity = { canopy: 0.434, groundCover: 0.2, flowers: 0.04 }

/** A plant's own tiles. What must never occupy an exit CELL, as opposed to be anchored in one. */
const PLANT_TILE = /^(trunk_|leaf_|canopy|cactus_|bush)/

const build = (width: number, seed: number, layout: 'woodland' | 'jungle' | 'meadow' = 'woodland'): StageData => {
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer',
      variant: 'forest',
      layout,
      cols: 60,
      rows: 40,
      nature: NATURE,
      pathway: { width },
      // Without these there is no route network and nothing below has anything to measure.
      options: { pathways: 2, exits: 4 },
    })
  } finally {
    Math.random = orig
  }
}

/** The plan, or a failure that says so rather than a case that quietly skips. */
function routesOf(stage: StageData): NonNullable<StageData['routes']> {
  if (!stage.routes) throw new Error('the build planned no routes, so there is no exit to measure')
  return stage.routes
}

/** The cells of the border line a gate sits on, `spread` cells either side of the gate's own run. */
function bandAround(gate: { side: string; cells: readonly { col: number; row: number }[] }, spread: number): { col: number; row: number }[] {
  const horizontal = gate.side === 'north' || gate.side === 'south'
  const first = gate.cells[0]
  const last = gate.cells[gate.cells.length - 1]
  const band: { col: number; row: number }[] = []
  for (let k = 1; k <= spread; k++) {
    band.push(horizontal ? { col: first.col - k, row: first.row } : { col: first.col, row: first.row - k })
    band.push(horizontal ? { col: last.col + k, row: last.row } : { col: last.col, row: last.row + k })
  }
  return band
}

// Every width the catalogue actually serves.
describe.each([[2], [3], [4]])('a pathway served %i cells wide', width => {
  const seeds = [1, 2, 3]

  test('every gate is exactly that wide, never the old constant 3', () => {
    for (const seed of seeds) {
      for (const gate of routesOf(build(width, seed)).gates) expect(gate.cells).toHaveLength(width)
    }
  })

  test('no trunk stands in a gate cell', () => {
    for (const seed of seeds) {
      const stage = build(width, seed)
      const gate = new Set(routesOf(stage).gates.flatMap(g => g.cells.map(c => `${c.col},${c.row}`)))
      expect(stage.trees.filter(t => gate.has(`${t.col},${t.row}`))).toEqual([])
    }
  })

  test('and the wood is still standing, so that zero means something', () => {
    for (const seed of seeds) expect(build(width, seed).trees.length).toBeGreaterThan(0)
  })

  test('every exit arrives wired: all of its cells, walk, and no target', () => {
    const stage = build(width, 1)
    const wired = exitConnectors(routesOf(stage).gates)
    expect(wired).toHaveLength(routesOf(stage).gates.length)
    for (const c of wired) {
      expect(c.cells).toHaveLength(width)
      expect(c.interaction).toBe('walk')
      // His to choose. An invented target is a wrong answer wearing the shape of a real one.
      expect(c.targetTemplateId).toBe('')
    }
  })
})

/**
 * THE OPENING IS THE GATE AND STOPS THERE.
 *
 * MEASURED ON THE GROUND, which is the thing he was looking at. The first attempt at this asserted on
 * `stage.pathwayCells` and passed on the broken build, because `sealMapEdge` DELETES a border cell from that
 * set at the moment it plants a tree on it: the set that was supposed to be the evidence is edited by the
 * very defect, so the over-wide cells had already removed themselves by the time the test asked.
 *
 * What survives is what is painted. A gateway writes its own floor label and its own paving tone onto every
 * lane cell, so a border cell wearing BOTH of those is a cell the map presents as part of the way out. The
 * rule is then exactly "one width": the cells at the border wearing the way are the gate's cells and no
 * others. On the reported build the woodland's border carried five cells of `floor` around a three-cell gate,
 * and the two extra ones held the trees.
 */
describe.each([['woodland'], ['jungle'], ['meadow']] as const)('%s: the way reaches the border only at its gate', layout => {
  test.each([[2], [3], [4]])('a pathway served %i cells wide', width => {
    const spills: string[] = []
    for (const seed of [1, 2, 3, 7]) {
      const stage = build(width, seed, layout)
      for (const gate of routesOf(stage).gates) {
        const wear = (c: { col: number; row: number }): string =>
          `${stage.ground[c.row]?.[c.col]}|${stage.floorColors?.[c.row]?.[c.col] ?? ''}`
        // What this gate's own cells wear. A gate over the river's mouth is paved by nobody and wears the
        // water, so there is no way-surface to measure and nothing to compare against.
        const worn = new Set(gate.cells.map(wear))
        if (worn.size !== 1 || [...worn][0].includes('water')) continue
        for (const beside of bandAround(gate, 2)) {
          if (beside.col < 0 || beside.row < 0 || beside.col >= stage.cols || beside.row >= stage.rows) continue
          if (worn.has(wear(beside))) spills.push(`${layout} w${width} s${seed} ${gate.side} reaches ${beside.col},${beside.row}`)
        }
      }
    }
    expect(spills).toEqual([])
  })
})

/**
 * THE SAME RULE, THROUGH THE REAL STAMP.
 *
 * The cases above check no tree is ANCHORED in a gate. That is not the whole rule: a tree is a multi-cell
 * composition, so an anchor on a legal cell can still stamp a trunk or a canopy INTO one. This builds the
 * stage and runs the actual `applyStageToGrid`, then asks the grid, which is the only thing that can catch
 * the spill.
 */
describe.each([['woodland'], ['jungle'], ['meadow']] as const)('%s exits keep no plant, through the real stamp', layout => {
  test.each([[2], [3], [4]])('a pathway served %i cells wide', width => {
    for (const seed of [1, 2, 3]) {
      const stage = build(width, seed, layout)
      const grid = new IsometricGrid(stage.cols, stage.rows)
      applyStageToGrid(stage, grid)
      const gate = new Set(routesOf(stage).gates.flatMap(g => g.cells.map(c => `${c.col},${c.row}`)))
      const stuck = grid.assets.filter(a => gate.has(`${a.col},${a.row}`) && PLANT_TILE.test(a.label ?? ''))
      expect(stuck.map(a => `${a.label}@${a.col},${a.row}`)).toEqual([])
    }
  })

  test('and the wood still stands in the same build', () => {
    for (const seed of [1, 2, 3]) {
      const stage = build(3, seed, layout)
      const grid = new IsometricGrid(stage.cols, stage.rows)
      applyStageToGrid(stage, grid)
      expect(grid.assets.filter(a => /^trunk_/.test(a.label ?? '')).length).toBeGreaterThan(0)
    }
  })
})
