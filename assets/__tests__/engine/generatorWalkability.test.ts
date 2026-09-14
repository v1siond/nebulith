/**
 * COMMON SENSE ABOUT WHAT BLOCKS.
 *
 * And when I said the fix was backend data, he
 * corrected me: He
 * was right: `flower`, `grass`, `bush` and `decor_clover` are all `blocking: false` in the live DB, and the
 * generator was stamping `collision = true` over the top of them.
 *
 * THE RULE, in one test: a cell's collision comes from the thing standing IN it. So if everything a cell holds
 * is walkable, the cell is walkable. Water is not an occupant (you do not walk on water), a building footprint
 * is stamped later from `stage.buildings`, and a tree trunk is an occupant that blocks.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type ForestLayout, type StageData, type VariantId } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog, type GeneratorDef } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

function byKey(key: string): GeneratorDef | undefined {
  const walk = (gs: readonly GeneratorDef[]): GeneratorDef | undefined => {
    for (const g of gs) {
      if (g.key === key) return g
      const hit = g.children ? walk(g.children) : undefined
      if (hit) return hit
    }
    return undefined
  }
  return walk(CATALOG.flatMap(c => c.generators))
}

function grow(variant: VariantId, layout: ForestLayout | undefined, genKey: string | undefined, seed: number): StageData {
  const g = genKey ? byKey(genKey) : undefined
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant, layout, cols: 40, rows: 30,
      nature: g?.config.nature, palette: g?.config.palette, formation: g?.config.formation,
      treeMix: g?.config.trees, subZones: g?.config.subZones, crossings: g?.config.crossings,
      settlement: g?.config.settlement,
    })
  } finally {
    Math.random = orig
  }
}

const CASES: Array<[string, VariantId, ForestLayout | undefined, string | undefined]> = [
  ['a woodland', 'forest', 'woodland', 'forest_woodland'],
  ['a jungle', 'forest', 'jungle', 'forest_jungle'],
  ['a swamp jungle', 'forest', 'jungle', 'forest_jungle_swamp'],
  ['a meadow', 'forest', 'meadow', 'forest_meadow'],
  ['a town', 'town', undefined, 'town_default'],
  ['a cave', 'cave', undefined, 'cave_default'],
  ['a temple', 'temple', undefined, 'temple_default'],
]

/** Cells a building's footprint covers: blocked by the building, stamped after generation. */
function footprints(s: StageData): Set<string> {
  const out = new Set<string>()
  for (const b of s.buildings) {
    for (let r = b.row - (b.height - 1); r <= b.row; r++) {
      for (let c = b.col; c < b.col + b.length; c++) out.add(`${c},${r}`)
    }
  }
  return out
}

describe('a cell is blocked by what stands in it, not by a flag stamped over it', () => {
  it.each(CASES)('%s: a cell holding only walkable things is walkable', (_name, variant, layout, genKey) => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = grow(variant, layout, genKey, seed)
      const trees = new Set(s.trees.map(t => `${t.col},${t.row}`))
      const built = footprints(s)
      // A lamp post, a fountain: a composition ANCHOR, not a prop, and it blocks its own cell for good reason.
      // Without this the test reads "a flower is blocking" where a lamp is standing on a flower bed.
      const anchored = new Set(s.compositions.map(c => `${c.col},${c.row}`))
      const propsAt = new Map<string, typeof s.props>()
      for (const p of s.props) {
        const key = `${p.col},${p.row}`
        propsAt.set(key, [...(propsAt.get(key) ?? []), p])
      }

      const wrong: string[] = []
      for (const [key, held] of propsAt) {
        const [col, row] = key.split(',').map(Number)
        if (!s.collision[row][col]) continue
        if (held.some(p => p.blocking)) continue // something in it blocks: correct
        if (trees.has(key) || built.has(key) || anchored.has(key)) continue // a trunk, a building, a lamp: correct
        const ground = s.ground[row][col]
        if (ground.includes('water') || ground === 'swamp') continue // water is not walked on
        wrong.push(`${key} blocked, holding only ${held.map(p => p.label ?? p.type).join(' + ')}`)
      }
      expect(wrong).toEqual([])
    }
  })
})
