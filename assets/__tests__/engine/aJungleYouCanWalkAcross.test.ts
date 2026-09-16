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
 * named, across every wilderness environment the backend serves:
 *
 *   · WALKABLE, the share of the interior you can stand on at all.
 *   · PLACEABLE, the share with open ground on all four sides, which is what it takes to put a chest or a
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
      // THE PATHWAY TOO, and leaving it off made this test measure a map nobody gets. A way is dressed with
      // what the template serves, and some of that dressing BLOCKS: a cut trail is lined with the thicket it
      // was cut through. Measured when it was added, that cost the plain jungle 8 points of placeable room
      // and put it under the floor below, while this file went on reporting the undressed map as fine.
      pathway: c.pathway,
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

// ONE FLOOR, EVERY ROW THE BACKEND SERVES.
//
// This was a hand-kept table of keys and per-key floors, and it named subtypes that no longer exist: a super
// dense jungle and a dense wood were rows of their own, each calibrated to its own number. A type is an
// ENVIRONMENT now, there are nine of them, and the property has not changed with the shape of the catalog:
// whatever a row is tuned to, it has to be a map you can cross and put things on. So the rows are walked
// rather than listed, and a new environment is held to the same bar the day it is seeded.
//
// The floor sits a few points under the tightest row measured (the ruins, at 0.69 walkable, and the swamp, at
// 0.40 placeable), so a real regression trips it and seed noise does not.
const MIN_WALKABLE = 0.64
const MIN_PLACEABLE = 0.34

/** Every wilderness row, so this file keeps no list of them. */
const wilderness = () => CATALOG.find(c => c.key === 'wilderness')?.generators ?? []

describe('every wilderness row is a map you can cross and put things on', () => {
  it.each(wilderness().map(g => g.key))('%s leaves room to walk and to place', key => {
    const { walkable, placeable } = measure(key)
    expect({ key, walkable: walkable >= MIN_WALKABLE, placeable: placeable >= MIN_PLACEABLE })
      .toEqual({ key, walkable: true, placeable: true })
  })
})

describe('a jungle is still the densest forest', () => {
  it('is tighter than the woodland it is a grown-over version of', () => {
    expect(measure('forest_jungle').walkable).toBeLessThan(measure('forest_woodland').walkable)
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
