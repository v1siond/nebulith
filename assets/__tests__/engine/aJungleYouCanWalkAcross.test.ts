/**
 * A JUNGLE IS A MAP YOU CAN CROSS, AND PUT THINGS ON.
 *
 * *"the density of trees is conflicting with the functionality of the map, user can't move, we can't put any
 * treasures nor units around"* (2026-09-15).
 *
 * Three separate canopy cuts (0.62 -> 0.434 -> 0.369) each read as no change on the map, and the reason is a
 * loop between two numbers that look independent in the config. A jungle's undergrowth density is the served
 * `groundCover` times `jungleFloorReach`, and that reach is the walkable floor over what is left to plant on.
 * Thin the trees and the floor gets bigger, so the SAME served number plants proportionally MORE thicket.
 * Measured at a fixed groundCover of 0.3, cutting canopy from 0.369 to 0.24 removed 31% of the trees and left
 * the walkable share exactly where it started, because thicket went 159 -> 183.
 *
 * So a test that watches only the tree count cannot see this. These cases measure the two things he actually
 * named, against the two forests he has already called correct:
 *
 *   · WALKABLE  — the share of the interior you can stand on at all.
 *   · PLACEABLE — the share with open ground on all four sides, which is what it takes to put a chest or a
 *                 unit somewhere without it being wedged against a trunk.
 *
 * The border ring is excluded from both. `sealMapEdge` deliberately plants a tree on every un-collided cell
 * in the outer two rings, so it is a wall by design and counting it as blockage measured the wall instead of
 * the room. It also hides a cut: thin the interior and the ring simply has more bare cells to fill, which is
 * why the whole-map tree count went UP (397 -> 419) during a cut that was working.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

type Node = { key?: string; layout?: string; config?: Record<string, never>; children?: Node[] }

/** The served generator with this key, variants included. Nothing here is a value the frontend invents. */
function servedConfig(key: string): Node {
  const stack: Node[] = [...CATALOG.flatMap(c => (c as unknown as { generators?: Node[] }).generators ?? [])]
  while (stack.length) {
    const node = stack.pop()!
    if (node.key === key) return node
    stack.push(...(node.children ?? []))
  }
  throw new Error(`no served generator ${key}`)
}

function build(key: string, seed: number): StageData {
  const node = servedConfig(key)
  const c = node.config ?? ({} as Record<string, never>)
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout: (node.layout ?? 'jungle') as never, cols: 40, rows: 40,
      options: { exits: '2', pathways: '2' }, nature: c.nature, palette: c.palette, formation: c.formation,
      treeMix: c.trees, subZones: c.subZones, crossings: c.crossings, entrance: c.entrance,
    })
  } finally {
    Math.random = orig
  }
}

/** The map minus the sealed border ring: the part a player is meant to use. */
const SEALED_RING = 2

function room(s: StageData): { walkable: number; placeable: number } {
  const inRing = (col: number, row: number) => Math.min(col, row, s.cols - 1 - col, s.rows - 1 - row) < SEALED_RING
  const open = (col: number, row: number) =>
    col >= 0 && row >= 0 && col < s.cols && row < s.rows && !s.collision[row][col]
  let cells = 0
  let free = 0
  let elbow = 0
  for (let row = 0; row < s.rows; row++) {
    for (let col = 0; col < s.cols; col++) {
      if (inRing(col, row)) continue
      cells++
      if (!open(col, row)) continue
      free++
      if (open(col - 1, row) && open(col + 1, row) && open(col, row - 1) && open(col, row + 1)) elbow++
    }
  }
  return { walkable: free / cells, placeable: elbow / cells }
}

/** Averaged over seeds, because one seed's creek can wander and swing either number by several points. */
const SEEDS = [3, 4, 5, 6]
function measure(key: string): { walkable: number; placeable: number } {
  const rows = SEEDS.map(seed => room(build(key, seed)))
  const mean = (pick: (r: { walkable: number; placeable: number }) => number) =>
    rows.reduce((a, r) => a + pick(r), 0) / rows.length
  return { walkable: mean(r => r.walkable), placeable: mean(r => r.placeable) }
}

// Every template whose whole point is being dense, with the floor each one has to clear. They differ because
// a super dense jungle is SUPPOSED to be the tightest map in the game; what it may not be is one you cannot
// cross. Measured values at the time of writing sit 3 to 7 points above each floor, so a real regression
// trips these and seed noise does not.
//
// `forest_woodland_dense` is in here because measuring the jungles turned it up: it was the most impassable
// template in the game, at 46% walkable with 420 trees and 278 thicket, worse than any rainforest. Its rule
// was already written in the generator source, that a dense wood must not out-thicket a rainforest, but it
// was written as "under the jungle's 0.62" and the jungle had been thinned to 0.31 without it noticing. That
// is what this file is for: a number nobody can measure by reading it.
const JUNGLES: ReadonlyArray<readonly [string, number, number]> = [
  ['forest_jungle', 0.72, 0.38],
  ['forest_jungle_dense', 0.60, 0.36],
  ['forest_jungle_swamp', 0.75, 0.50],
  ['forest_jungle_island', 0.68, 0.42],
  ['forest_jungle_ruins', 0.66, 0.35],
  ['forest_woodland_dense', 0.62, 0.42],
]

describe('every jungle is a map you can cross and put things on', () => {
  for (const [key, minWalkable, minPlaceable] of JUNGLES) {
    it(`${key} leaves room to walk and to place`, () => {
      const { walkable, placeable } = measure(key)
      expect({ key, walkable: walkable >= minWalkable, placeable: placeable >= minPlaceable })
        .toEqual({ key, walkable: true, placeable: true })
    })
  }
})

describe('a jungle is still the densest forest', () => {
  it('is tighter than the woodland it is a grown-over version of', () => {
    expect(measure('forest_jungle').walkable).toBeLessThan(measure('forest_woodland').walkable)
  })

  it('and its super dense variant is the tightest map of the lot', () => {
    const dense = measure('forest_jungle_dense').walkable
    for (const [key] of JUNGLES.filter(([k]) => k !== 'forest_jungle_dense')) {
      expect({ key, tighterThanDense: measure(key).walkable <= dense }).toEqual({ key, tighterThanDense: false })
    }
  })

  it('a dense WOOD does not out-thicket a rainforest, whatever either one is tuned to', () => {
    // The invariant the generator source states in words, measured instead of pinned to a literal.
    expect(measure('forest_woodland_dense').walkable).toBeGreaterThan(measure('forest_jungle_dense').walkable)
    // and it is still a DENSE wood: far tighter than the plain one it is a variation of
    expect(measure('forest_woodland_dense').walkable).toBeLessThan(measure('forest_woodland').walkable - 0.1)
  })
})

describe('the undergrowth does not grow back what the canopy gives up', () => {
  // The loop, stated as a test. Cutting the canopy has to make the map MORE walkable. When `jungleFloorReach`
  // was free to compensate, this held at 71% across a cut that removed a third of the trees.
  it('a thinner canopy opens the map, it does not just move the blockage into the thicket', () => {
    const node = servedConfig('forest_jungle')
    const served = (node.config ?? {}) as Record<string, never>
    const withCanopy = (canopy: number) => {
      const rows = SEEDS.map(seed => {
        const orig = Math.random
        Math.random = makeRng(seed)
        try {
          return room(generateStage({
            zone: 'summer', variant: 'forest', layout: 'jungle', cols: 40, rows: 40,
            options: { exits: '2', pathways: '2' },
            nature: { ...(served.nature as object), canopy } as never,
            palette: served.palette, formation: served.formation, treeMix: served.trees,
            subZones: served.subZones, crossings: served.crossings, entrance: served.entrance,
          }))
        } finally {
          Math.random = orig
        }
      })
      return rows.reduce((a, r) => a + r.walkable, 0) / rows.length
    }
    const thick = withCanopy(0.45)
    const thin = withCanopy(0.20)
    // More than a rounding step: half the canopy has to buy real floor.
    expect(thin - thick).toBeGreaterThan(0.04)
  })
})
