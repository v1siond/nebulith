/**
 * THE FLOOR IS A COLOUR, on every template.
 *
 * The meadow lays one flat tile and paints each cell's colour on it. These pin the same for the rest: the textured
 * tile a place used to lay wall to wall is gone from its open ground, its colour is kept on the flat floor, and a
 * textured tile only turns up as an ornament (a moss patch) or where it belongs to something else (a building's
 * foundation).
 */
import '@/__tests__/helpers/installTilesetSeed'
import { FLAT_FLOOR, generateStage, stagePaint, type ForestLayout, type StageData, type VariantId } from '@/engine/stageGenerator'
import { groundTileColor } from '@/engine/tileset/groundColor'
import { cavePalette, templePalette, zonePalette, type ZoneId } from '@/engine/zones'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

/** A forest layout is built from its served template, the way the editor builds it. */
function grow(variant: VariantId, zone: ZoneId, seed = 7, layout?: ForestLayout): StageData {
  const config = layout ? findGenerator(CATALOG, 'forest', layout)?.config : undefined
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone, variant, cols: 40, rows: 30, layout,
      // AND ITS PATHWAY, which the editor passes and this omitted, so every case here was measuring a forest
      // with no served way rather than the one the app builds.
      nature: config?.nature, palette: config?.palette, formation: config?.formation, pathway: config?.pathway,
      treeMix: config?.trees, subZones: config?.subZones,
    })
  } finally {
    Math.random = orig
  }
}

const cellsWhere = (s: StageData, match: (label: string) => boolean): Array<[number, number]> => {
  const out: Array<[number, number]> = []
  s.ground.forEach((row, r) => row.forEach((g, c) => { if (match(g)) out.push([c, r]) }))
  return out
}
const count = (s: StageData, label: string) => cellsWhere(s, g => g === label).length

describe('every flat cell keeps a colour', () => {
  const places: Array<[VariantId, ZoneId]> = [
    ['town', 'autumn'], ['city', 'winter'], ['cave', 'summer'], ['temple', 'desert'], ['boss-stage', 'lava'],
  ]
  it.each(places)('%s in %s', (variant, zone) => {
    const s = grow(variant, zone)
    const flat = cellsWhere(s, g => g === FLAT_FLOOR)
    expect(flat.length).toBeGreaterThan(0)
    expect(flat.filter(([c, r]) => !s.floorColors[r][c])).toEqual([])
  })
})

describe('a season whose ground is textured lays it as colour, not tiles', () => {
  // Spring and summer already lay the flat meadow tile. Winter lays snow, autumn its leaf litter, the desert sand.
  it.each([['winter'], ['autumn'], ['desert']] as Array<[ZoneId]>)('a %s town', zone => {
    const textured = zonePalette(zone)!.groundTypes[0]
    const s = grow('town', zone)
    expect(count(s, textured)).toBe(0)
    // Every flat cell wears a colour it was laid in: the season's ground, the road tint, or the plaza stone.
    const flat = cellsWhere(s, g => g === FLAT_FLOOR)
    const laidIn = (c: number, r: number) => [textured, 'road', 'path_stone'].some(m => s.floorColors[r][c] === groundTileColor(m, c, r))
    expect(flat.filter(([c, r]) => !laidIn(c, r))).toEqual([])
    expect(flat.some(([c, r]) => s.floorColors[r][c] === groundTileColor(textured, c, r))).toBe(true)
  })

  it('a winter wood, and its trails are flat floor in the trail colour', () => {
    const s = grow('forest', 'winter', 7, 'woodland')
    expect(count(s, 'snow')).toBe(0)
    expect(cellsWhere(s, g => g === FLAT_FLOOR).filter(([c, r]) => !s.floorColors[r][c])).toEqual([])
    const trail = zonePalette('winter')!.trail
    expect(count(s, trail)).toBe(0)
    // THE COLOUR THE GENERATOR ACTUALLY PAINTS WITH: the tone its own PATHWAY serves. It read the palette's
    // trail, which is where the colour used to live and no longer does. The pathway kind carries it, so a
    // template that picks gravel is painted gravel rather than whatever its parent's palette said.
    const paint = (findGenerator(CATALOG, 'forest', 'woodland')?.config as { pathway?: { tone?: string } } | undefined)?.pathway?.tone
    expect(typeof paint).toBe('string')
    const trailCells = cellsWhere(s, g => g === FLAT_FLOOR).filter(([c, r]) => s.floorColors[r][c] === paint)
    expect(trailCells.length).toBeGreaterThan(0)
  })
})

describe('a cave: a flat floor, and its moss only as ornaments', () => {
  it.each([['spring'], ['summer'], ['autumn'], ['winter']] as Array<[ZoneId]>)('%s', zone => {
    const pal = cavePalette(zone)!
    const s = grow('cave', zone, 11)
    expect(count(s, pal.floor)).toBe(0) // the textured cave floor no longer carpets the cavern
    const open = cellsWhere(s, g => g === FLAT_FLOOR || g === pal.accent).length
    const ornaments = count(s, pal.accent)
    // It used to roll every floor cell against accentChance (14 to 24% of the floor textured). As ornaments
    // they are a few patches, the meadow's plot spacing: well under a tenth of the floor.
    expect(ornaments / open).toBeLessThan(0.1)
  })

  it('the patches are patches: an ornament cell almost always has another beside it', () => {
    const pal = cavePalette('summer')!
    const s = grow('cave', 'summer', 3)
    const moss = new Set(cellsWhere(s, g => g === pal.accent).map(([c, r]) => `${c},${r}`))
    expect(moss.size).toBeGreaterThan(0)
    const lonely = [...moss].filter(key => {
      const [c, r] = key.split(',').map(Number)
      return ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => moss.has(`${c + dc},${r + dr}`))
    })
    expect(lonely.length / moss.size).toBeLessThan(0.25)
  })
})

describe('a temple: the checkered hall is two colours on the flat floor', () => {
  it.each([['summer'], ['winter'], ['desert']] as Array<[ZoneId]>)('%s', zone => {
    const pal = templePalette(zone)!
    const s = grow('temple', zone, 5)
    expect(count(s, pal.floor)).toBe(0)
    expect(count(s, pal.accent)).toBe(0)
    const tones = new Set(cellsWhere(s, g => g === FLAT_FLOOR).map(([c, r]) => s.floorColors[r][c]))
    const floorTone = new Set(cellsWhere(s, g => g === FLAT_FLOOR).map(([c, r]) => groundTileColor(pal.floor, c, r)))
    const accentTone = new Set(cellsWhere(s, g => g === FLAT_FLOOR).map(([c, r]) => groundTileColor(pal.accent, c, r)))
    expect([...floorTone].some(t => tones.has(t))).toBe(true)
    expect([...accentTone].some(t => tones.has(t))).toBe(true)
  })
})

describe('a settlement keeps stone only under its buildings', () => {
  it.each([['town', 'summer'], ['city', 'autumn']] as Array<[VariantId, ZoneId]>)('%s in %s', (variant, zone) => {
    const s = grow(variant, zone, 3)
    const footprint = new Set<string>()
    for (const b of s.buildings) {
      for (let r = b.row - (b.height - 1); r <= b.row; r++) for (let c = b.col; c < b.col + b.length; c++) footprint.add(`${c},${r}`)
    }
    const stone = cellsWhere(s, g => g === 'path_stone')
    expect(stone.length).toBeGreaterThan(0) // the foundations are still there
    expect(stone.filter(([c, r]) => !footprint.has(`${c},${r}`))).toEqual([]) // and nothing else is stone
  })

  it('door steps are flat, in the paving stone colour', () => {
    const s = grow('town', 'summer', 3)
    const steps = stagePaint(s).ground
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.every(g => g.type === FLAT_FLOOR && g.color === groundTileColor('path_stone', g.col, g.row))).toBe(true)
  })
})

describe('the meadow, the one this copies, is left exactly as it was', () => {
  it('still lays its own flat meadow tile and nothing flattened', () => {
    const s = grow('forest', 'summer', 7, 'meadow')
    expect(count(s, 'meadow')).toBeGreaterThan(0)
    expect(count(s, FLAT_FLOOR)).toBe(0)
  })
})
