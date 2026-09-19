import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { isWaterSetLabel } from '@/engine/waterBody'
import { assetKind } from '@/game/artStyle'
import { makeRng } from '@/lib/math'

/**
 * A BORDER FACES THE THING THAT IS NOT WATER.
 *
 * *"identify all the cells inside and around the river that AREN'T water and make sure the borders of the
 * water points towards it, this means, we draw a border connected to each thing that IS NOT water in the
 * direction of the thing"*.
 *
 * So the rule is per SIDE, not per cell: for every water cell, every orthogonal neighbour that is not water
 * must have a border facing it. A cell with land on two sides needs two. A lone cell needs four.
 */
const SIDES = [
  { name: 'N', dc: 0, dr: -1 },
  { name: 'E', dc: 1, dr: 0 },
  { name: 'S', dc: 0, dr: 1 },
  { name: 'W', dc: -1, dr: 0 },
] as const

/** Which sides a 9-slice suffix actually puts a rim on. `_c` is interior: no rim at all. */
const RIM_OF_SUFFIX: Readonly<Record<string, string>> = {
  tl: 'NW', t: 'N', tr: 'NE',
  l: 'W', c: '', r: 'E',
  bl: 'SW', b: 'S', br: 'SE',
}

const isWater = (l: string | undefined) => !!l && /water|oasis|koi_pond/.test(l)
const suffixOf = (label: string): string => {
  const m = /_(tl|t|tr|l|c|r|bl|b|br)$/.exec(label.replace(/_f\d$/, ''))
  return m ? m[1] : ''
}

const build = (seed: number, layout = 'woodland'): StageData => {
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout: layout as never, cols: 40, rows: 40,
      options: { exits: '2', pathways: '2', river: 'through' },
    })
  } finally { Math.random = orig }
}

/** Every side of every water cell that meets something which is not water, and whether a rim faces it. */
function auditBorders(s: StageData) {
  const missing: string[] = []
  const beyondTheFamily: string[] = []
  let sidesNeeded = 0
  for (let row = 0; row < s.rows; row++) {
    for (let col = 0; col < s.cols; col++) {
      const here = s.ground[row]?.[col]
      if (!isWater(here)) continue
      const rim = RIM_OF_SUFFIX[suffixOf(here)] ?? ''
      // HOW MANY SIDES THIS CELL MEETS LAND ON. A nine-piece family can name at most TWO (a corner), so a
      // cell with three or four is a gap in the CATALOG, not a mistake in the choosing: expressing it needs
      // the full sixteen-piece set, or an edge drawn per side instead of one piece per cell. Counted and
      // pinned rather than hidden, so it cannot grow unnoticed.
      let open = 0
      for (const side of SIDES) {
        const n = s.ground[row + side.dr]?.[col + side.dc]
        if (n !== undefined && !isWater(n)) open++
      }
      if (open > 2) { beyondTheFamily.push(`${col},${row} meets land on ${open} sides`); continue }
      for (const side of SIDES) {
        const n = s.ground[row + side.dr]?.[col + side.dc]
        // Off the map is not a thing the water meets; it is the end of the world.
        if (n === undefined) continue
        if (isWater(n)) continue
        sidesNeeded++
        if (!rim.includes(side.name)) missing.push(`${col},${row} meets land ${side.name} but wears ${here} (rim ${rim || 'none'})`)
      }
    }
  }
  return { sidesNeeded, missing, beyondTheFamily }
}

describe('every side of the water that meets land carries a border facing it', () => {
  it.each([1, 2, 3, 7])('woodland seed %i', seed => {
    const s0 = build(seed)
    const { sidesNeeded, missing, beyondTheFamily } = auditBorders(s0)
    let water = 0, interior = 0
    const suffixes: Record<string, number> = {}
    for (let r = 0; r < s0.rows; r++) for (let c = 0; c < s0.cols; c++) {
      const g = s0.ground[r]?.[c]
      if (!isWater(g)) continue
      water++
      const sfx = suffixOf(g!)
      suffixes[sfx || '(none)'] = (suffixes[sfx || '(none)'] ?? 0) + 1
      if (sfx === 'c') interior++
    }
    console.log(`seed ${seed}: water=${water} interior=${interior} sidesMeetingLand=${sidesNeeded} unbordered=${missing.length} beyondTheFamily=${beyondTheFamily.length}`)
    // At most a couple of cells a map are pinched thin enough to meet land on three sides. Pinned so a change
    // that makes rivers stringy shows up here instead of on his screen.
    expect({ seed, beyond: beyondTheFamily.length > 3 }).toEqual({ seed, beyond: false })
    expect(sidesNeeded).toBeGreaterThan(20) // the river exists, so zero would mean nothing was measured
    expect({ seed, unbordered: missing.length, of: sidesNeeded, sample: missing.slice(0, 4) })
      .toEqual({ seed, unbordered: 0, of: sidesNeeded, sample: [] })
  })
})

/**
 * AND THE RENDERER HAS TO RECOGNISE A BORDER PIECE, which is where this was actually broken.
 *
 * The data above was right all along. What was wrong is that `iso.ts` decided whether to turn a border
 * picture by asking `isWaterSetLabel(assetKind(asset))`, and `assetKind` FOLDS every water label onto the
 * single kind `water` while `isWaterSetLabel` tests membership in the set of PIECE labels. So the question
 * was "is the string 'water' one of water_smooth_river_tl and its siblings", the answer was always no, and
 * the quarter-turn correction never ran once. Every rim was drawn a quarter-turn off its own cell.
 *
 * `WATER.md` §5b describes that correction as done and cites a test called `waterRimFacesItsBank`. No such
 * test exists, which is how a constant-false condition survived.
 */
describe('the renderer can tell a border piece from a kind', () => {
  it('a folded KIND is not a piece label, which is the mistake that hid this', () => {
    expect(isWaterSetLabel('water_smooth_river_tl')).toBe(true)
    // The fold. This is what the render path used to hand it.
    expect(assetKind({ type: 'floor', tileKey: 'water_smooth_river_tl' })).toBe('water')
    expect(isWaterSetLabel(assetKind({ type: 'floor', tileKey: 'water_smooth_river_tl' }))).toBe(false)
  })

  it('every border piece a generated river lays is one the renderer will turn', () => {
    const s = build(1)
    const pieces = new Set<string>()
    for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
      const g = s.ground[r]?.[c]
      if (isWater(g) && suffixOf(g!) && suffixOf(g!) !== 'c') pieces.add(g!)
    }
    expect(pieces.size).toBeGreaterThan(4)
    const unturnable = [...pieces].filter(p => !isWaterSetLabel(p))
    expect(unturnable).toEqual([])
  })
})
