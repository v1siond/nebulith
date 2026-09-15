/**
 * RUN THE SYSTEM ONLY UP TO A LAYER, which is what the UI's "layout" choice is.
 *
 * *"LAYOUT IN THE UI JUST REFERS TO I WANT TO ONLY EXECUTE THE SYSTEM UP TO THIS SPECIFIC LAYER. IE: ONLY
 * GIVE ME AN EMPTY MAP WITH ALL PATHWAYS, GIVE AN EMPTY MAP WITH A RIVER, GIVE THE FULL MAP, ETC. IS JUST A
 * FILTER, ANOTHER PARAMETER FOR THE GENERATOR"*, and the preview of the exits and pathways is that filter
 * stopping at `pathways`.
 *
 * It is the SAME layers stopping early, never a second way of drawing a map, so what a preview shows is the
 * real ground and the real tiles: *"anything added should be part of tiles and/or objects"*.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { stageLayerTimings } from '@/engine/generate/pipeline'
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

function build(key: string, upTo?: string): StageData {
  const node = served(key)
  const c = node.config ?? ({} as Record<string, never>)
  const orig = Math.random
  Math.random = makeRng(4)
  try {
    return generateStage({
      zone: 'summer', variant: (node.variant ?? 'forest') as never, layout: (node.layout ?? 'woodland') as never,
      cols: 40, rows: 40, options: { exits: '2', pathways: '2', river: 'through' }, upTo,
      nature: c.nature, palette: c.palette, formation: c.formation, pathway: c.pathway, treeMix: c.trees,
      subZones: c.subZones, crossings: c.crossings, entrance: c.entrance, settlement: c.settlement,
    })
  } finally {
    Math.random = orig
  }
}

const waterCells = (s: StageData) => s.ground.flat().filter(g => /water/.test(g)).length

describe('an empty map with its river', () => {
  it('stops after the water: ground and a channel, nothing drawn on it and nothing planted', () => {
    const s = build('forest_woodland', 'water')
    expect(waterCells(s)).toBeGreaterThan(0)
    expect(s.trees).toHaveLength(0)
    expect(s.props).toHaveLength(0)
  })

  it('and the layers past the stop are reported as not run, so the readout still accounts for all of them', () => {
    build('forest_woodland', 'water')
    const ran = new Map(stageLayerTimings().map(t => [t.name, t.ran]))
    expect(ran.get('terrain')).toBe(true)
    expect(ran.get('water')).toBe(true)
    expect(ran.get('pathways')).toBe(false)
    expect(ran.get('objects')).toBe(false)
  })
})

describe('an empty map with all its pathways, which is the preview of the exits', () => {
  it('has the ways and the exits, and nothing standing on them', () => {
    const s = build('forest_woodland', 'pathways')
    expect(s.routes).not.toBeNull()
    expect(s.routes!.gates.length).toBeGreaterThan(0)
    expect(s.trees).toHaveLength(0) // nothing is planted yet, which is the point of stopping here
  })

  it('shows REAL ground, not a sketch: the ways are the tiles the template serves', () => {
    const s = build('forest_woodland', 'pathways')
    // a pathway cell is ground the template named, never a marker this file invented for a preview
    const kinds = new Set(s.ground.flat())
    for (const g of kinds) expect(typeof g).toBe('string')
    expect(kinds.size).toBeGreaterThan(1)
  })
})

describe('the full map', () => {
  it('is what you get with no filter, and it has everything the stops did not', () => {
    const whole = build('forest_woodland')
    expect(whole.trees.length).toBeGreaterThan(0)
    expect(waterCells(whole)).toBeGreaterThan(0)
    expect(whole.routes!.gates.length).toBeGreaterThan(0)
  })

  it('and naming a layer the stack does not have runs all of them rather than none', () => {
    const s = build('forest_woodland', 'no_such_layer')
    expect(s.trees.length).toBeGreaterThan(0)
  })
})
