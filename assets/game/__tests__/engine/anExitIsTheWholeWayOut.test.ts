import '@/__tests__/helpers/installTilesetSeed' // the generator reads all tile/composition data from the fixture
import { generateStage, type NatureDensity } from '@/engine/stageGenerator'
import { applyStageToGrid } from '@/game/editor/applyStage'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { exitConnectors } from '@/game/editor/connectors'
import { makeRng } from '@/lib/math'

/**
 * AN EXIT IS THE FULL SERVED WIDTH, AND NOTHING STANDS IN IT. PATHWAYS.md §4.
 *
 * The width used to be the constant 3 and the four entrance compositions were authored against it
 * (DESIGN-ENTRANCES.md says so out loud). Once it became served per template, 9 generators started serving 2
 * and the 5 CITIES started serving 4, while the gate kept covering 3. A city's leftover cell was ordinary
 * ground, so the scatter planted in the way out: measured over three builds, woodland 0, jungle 6, woodland
 * city 12, meadow city 13, woodland town 15.
 *
 * The third case is the one that matters most. Guarding the whole pathway instead of the gate emptied the map
 * (0 trees on every seed), and a forest with no trees answers "is anything in the way" with a perfect zero.
 * So every width checks the wood is still standing in the SAME build that checks the exit is clear.
 */
const NATURE: NatureDensity = { canopy: 0.434, groundCover: 0.2, flowers: 0.04 }

/** A plant's own tiles. What must never occupy an exit CELL, as opposed to be anchored in one. */
const PLANT_TILE = /^(trunk_|leaf_|canopy|cactus_|bush)/

const build = (width: number, seed: number, layout: 'woodland' | 'jungle' | 'meadow' = 'woodland') => {
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
    })
  } finally {
    Math.random = orig
  }
}

// Every width the catalogue actually serves.
describe.each([[2], [3], [4]])('a pathway served %i cells wide', width => {
  const seeds = [1, 2, 3]

  test('every gate is exactly that wide, never the old constant 3', () => {
    for (const seed of seeds) {
      const stage = build(width, seed)
      if (!stage.routes) continue
      for (const gate of stage.routes.gates) expect(gate.cells).toHaveLength(width)
    }
  })

  test('no trunk stands in a gate cell', () => {
    for (const seed of seeds) {
      const stage = build(width, seed)
      if (!stage.routes) continue
      const gate = new Set(stage.routes.gates.flatMap(g => g.cells.map(c => `${c.col},${c.row}`)))
      expect(stage.trees.filter(t => gate.has(`${t.col},${t.row}`))).toEqual([])
    }
  })

  test('and the wood is still standing, so that zero means something', () => {
    for (const seed of seeds) expect(build(width, seed).trees.length).toBeGreaterThan(0)
  })

  test('every exit arrives wired: all of its cells, walk, and no target', () => {
    const stage = build(width, 1)
    if (!stage.routes) return
    const wired = exitConnectors(stage.routes.gates)
    expect(wired).toHaveLength(stage.routes.gates.length)
    for (const c of wired) {
      expect(c.cells).toHaveLength(width)
      expect(c.interaction).toBe('walk')
      // His to choose. An invented target is a wrong answer wearing the shape of a real one.
      expect(c.targetTemplateId).toBe('')
    }
  })
})

/**
 * THE SAME RULE, THROUGH THE REAL STAMP.
 *
 * The case above checks no tree is ANCHORED in a gate. That is not the whole rule: a tree is a multi-cell
 * composition, so an anchor on a legal cell can still stamp a trunk or a canopy INTO one. This builds the
 * stage and runs the actual `applyStageToGrid`, then asks the grid, which is the only thing that can catch
 * the spill.
 */
describe.each([['woodland'], ['jungle'], ['meadow']] as const)('%s exits keep no plant, through the real stamp', layout => {
  test.each([[2], [3], [4]])('a pathway served %i cells wide', width => {
    for (const seed of [1, 2, 3]) {
      const stage = build(width, seed, layout)
      if (!stage.routes) continue
      const grid = new IsometricGrid(stage.cols, stage.rows)
      applyStageToGrid(stage, grid)
      const gate = new Set(stage.routes.gates.flatMap(g => g.cells.map(c => `${c.col},${c.row}`)))
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
