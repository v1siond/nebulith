/**
 * A RIVER IS NOT A RIVER WITHOUT A CHANNEL.
 *
 * *"The water is wrong, we completely extracted it from the river channel logic, now we don't have rivers, we
 * have watter zones... a river is not a river withouyt a channel, a lake is not a lake without a crater zone,
 * and so on... water have many different types, beach, lake, puddle, river... we regresed"* (2026-09-15).
 *
 * He was right and the regression was the TOWN, which had just been given a river for the first time. Every
 * forest ends its build with `settleWaterDepth`, which grades the reach into a wadeable edge, a deep middle
 * and a bend where it turns, and the settlement was wired up without it. Measured: a town's river came out as
 * ONE flat `water` tile end to end with its banks standing above it 74% of the time, against a forest's 100%.
 * A water ZONE, which is exactly what he called it.
 *
 * Underneath that were two more, both of them objects taking ground the water already had: the PLAZA paved
 * straight over the channel and a building's FOUNDATION was laid in it, so 20 cells came out as `path_stone`
 * still sunk at elevation -1, a street lying in the river bed.
 *
 * These cases pin what a channel IS, on every template that can have one, so "it is just a blue area now"
 * fails here rather than on his screen.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

type Node = { key?: string; layout?: string; variant?: string; config?: Record<string, never>; children?: Node[] }

function served(key: string): Node {
  const stack: Node[] = [...CATALOG.flatMap(c => (c as unknown as { generators?: Node[] }).generators ?? [])]
  while (stack.length) {
    const node = stack.pop()!
    if (node.key === key) return node
    stack.push(...(node.children ?? []))
  }
  throw new Error(`no served generator ${key}`)
}

function build(key: string, river: string, seed = 4): StageData {
  const node = served(key)
  const c = node.config ?? ({} as Record<string, never>)
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: (node.variant ?? 'forest') as never, layout: (node.layout ?? 'woodland') as never,
      cols: 40, rows: 40, options: { exits: '2', pathways: '2', river, depth: '1' },
      nature: c.nature, palette: c.palette, formation: c.formation, pathway: c.pathway, treeMix: c.trees,
      subZones: c.subZones, crossings: c.crossings, entrance: c.entrance, settlement: c.settlement,
    })
  } finally {
    Math.random = orig
  }
}

const isWater = (g: string) => /water/.test(g)
const elevationAt = (s: StageData, col: number, row: number) => s.elevation?.[row]?.[col] ?? 0

function waterCells(s: StageData): Array<{ col: number; row: number }> {
  const out: Array<{ col: number; row: number }> = []
  for (let row = 0; row < s.rows; row++) {
    for (let col = 0; col < s.cols; col++) if (isWater(s.ground[row][col])) out.push({ col, row })
  }
  return out
}

// Every template that can carry a river, and the three courses it can take.
const TEMPLATES = ['forest_woodland', 'forest_meadow', 'forest_jungle', 'town_small', 'city_modern']
const COURSES = ['through', 'divides', 'around']

describe('the water is CUT INTO the map, not laid on top of it', () => {
  for (const key of TEMPLATES) {
    it(`${key} digs its channel below the walking floor`, () => {
      for (const course of COURSES) {
        const s = build(key, course)
        const cells = waterCells(s)
        expect({ key, course, hasWater: cells.length > 0 }).toEqual({ key, course, hasWater: true })
        const onTheFloor = cells.filter(({ col, row }) => elevationAt(s, col, row) >= 0)
        expect({ key, course, laidOnTheFloor: onTheFloor.length }).toEqual({ key, course, laidOnTheFloor: 0 })
      }
    })
  }
})

describe('and the ground beside it is its BANK', () => {
  for (const key of TEMPLATES) {
    it(`${key} stands its banks above the water, on every course`, () => {
      for (const course of COURSES) {
        const s = build(key, course)
        let pairs = 0
        const below: string[] = []
        for (const { col, row } of waterCells(s)) {
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const c = col + dc
            const r = row + dr
            if (c < 0 || r < 0 || c >= s.cols || r >= s.rows) continue
            if (isWater(s.ground[r][c])) continue
            pairs++
            // A DECK is the one thing allowed at the water's own level: it is the crossing, not the bank.
            if (s.decks?.has(`${c},${r}`)) continue
            if (elevationAt(s, c, r) > elevationAt(s, col, row)) continue
            below.push(`${c},${r} ${s.ground[r][c]}`)
          }
        }
        expect({ key, course, pairs: pairs > 0 }).toEqual({ key, course, pairs: true })
        // This is the one that caught the plaza paving over the channel and the foundation laid in it.
        expect({ key, course, bankAtRiverLevel: below }).toEqual({ key, course, bankAtRiverLevel: [] })
      }
    })
  }
})

describe('a reach is GRADED, which is what tells a river from a patch of blue', () => {
  for (const key of TEMPLATES) {
    it(`${key} has more than one kind of water in its reach`, () => {
      // A wadeable edge, a deeper middle, a bend where it turns. One flat kind end to end is the water ZONE
      // he reported, and it is what a settlement produced before it settled its depth like every forest does.
      const kinds = new Set(build(key, 'divides').ground.flat().filter(isWater))
      expect({ key, kinds: kinds.size > 1 }).toEqual({ key, kinds: true })
    })
  }
})

describe('nothing is built in the water', () => {
  for (const key of ['town_small', 'city_modern']) {
    it(`${key} lays no building and no paving in its channel`, () => {
      for (const course of COURSES) {
        const s = build(key, course)
        const inWater = s.buildings.filter(b => isWater(s.ground[b.row]?.[b.col] ?? ''))
        expect({ key, course, buildingsInWater: inWater.length }).toEqual({ key, course, buildingsInWater: 0 })
        // and no cell is left dug without being water: that is paving lying in the river bed
        const dugButDry: string[] = []
        for (let row = 0; row < s.rows; row++) {
          for (let col = 0; col < s.cols; col++) {
            if (elevationAt(s, col, row) >= 0 || isWater(s.ground[row][col])) continue
            if (s.decks?.has(`${col},${row}`)) continue
            dugButDry.push(`${col},${row} ${s.ground[row][col]}`)
          }
        }
        expect({ key, course, dugButDry }).toEqual({ key, course, dugButDry: [] })
      }
    })
  }
})
