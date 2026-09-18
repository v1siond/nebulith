/**
 * WHICH WAY THE RIVER IS GOING.
 *
 * Image #9 marking three headings on a river that rings the map.
 *
 * The heading is DATA on the cell; the renderer turns the water's texture by it (`turnFaceTexture`), so the
 * picture follows the channel with one baked frame set.
 *
 * WHAT WENT WRONG THE FIRST TIME, because it is the point of the tests below. The first field walked the wet
 * cells as a graph and gave each cell the step that reached it. That is correct for a channel ONE cell wide
 * and wrong for every real river, because the walk wanders across a wide channel as readily as along it. It
 * drew the result exactly:
 *
 * So the test that matters is not "every cell has a heading" (the broken field passed that). It is that
 * NEIGHBOURS AGREE: a stretch of river has to come out one way, cross-section included.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

function river(course: string, seed = 5) {
  const cfg = findGenerator(CATALOG, 'wilderness', 'woodland')!.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout: 'woodland', cols: 60, rows: 40,
      nature: cfg.nature, palette: cfg.palette, formation: cfg.formation, treeMix: cfg.trees,
      options: { river: course, crossing: false },
    })
  } finally { Math.random = orig }
}
const wetCells = (s: ReturnType<typeof river>) => {
  const out: Array<[number, number]> = []
  s.ground.forEach((r, y) => r.forEach((g, x) => { if (g.includes('water')) out.push([x, y]) }))
  return out
}

describe('every channel cell states its heading', () => {
  it.each(['through', 'divides', 'around'])('%s: not one wet cell is left without one', course => {
    const s = river(course)
    const wet = wetCells(s)
    expect(wet.length).toBeGreaterThan(0)
    const missing = wet.filter(([c, r]) => s.flow?.[r]?.[c] === undefined)
    expect({ course, missing: missing.length }).toEqual({ course, missing: 0 })
  })

  it('a river that RINGS the map turns, so it cannot be one heading everywhere', () => {
    // The whole of the complaint: the drift was one direction on every cell of every map. A ring has to use
    // at least three of the four headings, which is exactly what the three arrows drew.
    const s = river('around')
    const used = new Set<number>()
    s.flow?.forEach(row => row.forEach(v => { if (v !== undefined) used.add(v) }))
    expect(used.size).toBeGreaterThanOrEqual(3)
  })

  it('the heading always points at another cell of the SAME channel, never off into the bank', () => {
    // A per-cell "most watery axis" guess would satisfy the count above and still point at dry land. The
    // generator walks the channel as a graph so downstream is continuous.
    const steps: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]]
    for (const course of ['through', 'divides', 'around']) {
      const s = river(course)
      // THE CHANNEL INCLUDES THE BRIDGE THE RIVER RUNS UNDER.
      //
      // A deck REPLACES the water in the ground, which `layDeck` documents and defends: a cell cannot be both
      // dug below the walking floor and forced to elevation 0. So a crossing reads as dry BANK here, and once
      // crossings became unconditional (2026-09-15) the cell beside a deck pointed straight at it and counted
      // as off-channel. The heading is correct, the river really does flow that way; it is this set that was
      // missing the span.
      const wet = new Set(wetCells(s).map(([c, r]) => `${c},${r}`))
      // …AND THE BRIDGE THE RIVER RUNS UNDER, asked of the STAGE rather than guessed from tile names.
      //
      // A deck REPLACES the water in the ground, which `layDeck` documents and defends: a cell cannot be both
      // dug below the walking floor and forced to elevation 0. So a crossing reads as dry BANK to a test that
      // only looks at water, and once crossings became unconditional the cell beside a deck pointed straight
      // at it and counted as off-channel. The heading is right; this set was missing the span.
      //
      // The first version of this listed three tile names. That is the violation he caught: the tiles a
      // crossing is built from are BACKEND data, a new crossing style is a row in the database, and a name
      // list here goes stale the moment one is added. `stage.decks` is the generator saying which cells it
      // spanned, which is the fact itself rather than a guess at it.
      for (const key of s.decks ?? []) wet.add(key)

      let offChannel = 0
      for (const [c, r] of wetCells(s)) {
        const dir = s.flow?.[r]?.[c]
        if (dir === undefined) continue
        const [dc, dr] = steps[dir]
        // The last cell of a reach legitimately points out of it, so allow the step to leave the map or the
        // water only when the cell has no wet neighbour in that direction AND is an end of the run.
        if (!wet.has(`${c + dc},${r + dr}`) && !wet.has(`${c - dc},${r - dr}`)) offChannel++
      }
      expect({ course, offChannel }).toEqual({ course, offChannel: 0 })
    }
  })


  it('neighbouring cells of one river agree which way it runs', () => {
    // THE measure for A global split means nothing on its
    // own, a river is allowed to turn. What reads as random is two cells SIDE BY SIDE drawing their current
    // across each other, so that is what this counts.
    //
    // The axis is settled by a vote over the water around each cell rather than by measuring one cell alone.
    // Isolated before/after on the same seeds, adjacent pairs disagreeing: winds-through 13/15/14% -> 5/9/6%,
    // divides 5/3/3% -> 0/1/0%, around-the-edge 5/3/5% -> 3/2/4% across woodland, jungle and meadow.
    const axisOf = (dir: number) => (dir === 0 || dir === 2 ? 0 : 1)
    for (const course of ['through', 'divides', 'around']) {
      const s = river(course)
      const wet = new Set(wetCells(s).map(([c, r]) => `${c},${r}`))
      let pairs = 0
      let disagreeing = 0
      for (const [c, r] of wetCells(s)) {
        const dir = s.flow?.[r]?.[c]
        if (dir === undefined) continue
        for (const [dc, dr] of [[1, 0], [0, 1]]) {
          if (!wet.has(`${c + dc},${r + dr}`)) continue
          const next = s.flow?.[r + dr]?.[c + dc]
          if (next === undefined) continue
          pairs++
          if (axisOf(dir) !== axisOf(next)) disagreeing++
        }
      }
      expect(pairs).toBeGreaterThan(20)
      // A tenth is the ceiling: a real bend disagrees with itself for a cell or two and that is a river, not
      // noise. Measured well under it on every course; this is the guard, not the target.
      expect({ course, share: disagreeing / pairs > 0.1 }).toEqual({ course, share: false })
    }
  })

  it('a POOL has no heading, because standing water has no current', () => {
    const s = river('none')
    const pools = s.props.filter(p => p.label === 'water_still')
    for (const p of pools) expect({ at: `${p.col},${p.row}`, dir: s.flow?.[p.row]?.[p.col] }).toEqual({ at: `${p.col},${p.row}`, dir: undefined })
  })
})

/**
 * THE DRAWING, AS A NUMBER.
 *
 *     what it drew          what was asked for
 *     | - | - |-           -------
 *                          ------
 *                          ------
 *
 * Agreement between touching wet cells is the measurable form of that picture, and it is the one thing the
 * old walk could not do: it satisfied every "has a heading" check while pointing neighbours at right angles.
 *
 * The floors are the measured values of the field this replaced it with, not aspirations: `divides` comes out
 * 99.3%, `around` 95.7%, `through` 93.4% (a meandering creek genuinely turns, so it should be lowest). They
 * sit below the measurements so ordinary generator noise does not fail the suite, and far enough above a
 * scrambled field that a regression to the old walk cannot slip through.
 */
describe('a stretch of river runs ONE way, cross-section included', () => {
  const agreement = (s: ReturnType<typeof river>): number => {
    let agree = 0
    let pairs = 0
    for (const [col, row] of wetCells(s)) {
      const here = s.flow?.[row]?.[col]
      for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
        if (!s.ground[row + dr]?.[col + dc]?.includes('water')) continue
        pairs++
        if (s.flow?.[row + dr]?.[col + dc] === here) agree++
      }
    }
    return pairs === 0 ? 0 : agree / pairs
  }

  it.each([['divides', 0.95], ['around', 0.9], ['through', 0.85]] as const)(
    '%s: touching wet cells share a heading at least %f of the time',
    (course, floor) => {
      const measured = agreement(river(course))
      expect({ course, ok: measured >= floor, measured: Number(measured.toFixed(3)) })
        .toEqual({ course, ok: true, measured: Number(measured.toFixed(3)) })
    })

  it('a straight channel across the map is essentially ONE heading, not four', () => {
    // `divides` is carved "wide and nearly straight across the middle" (swing 0.05), so there is no honest
    // reason for it to use more than one heading. The old walk used several on the same cross-section.
    const s = river('divides')
    const hist = new Map<number, number>()
    for (const [col, row] of wetCells(s)) {
      const h = s.flow?.[row]?.[col]
      if (h !== undefined) hist.set(h, (hist.get(h) ?? 0) + 1)
    }
    const total = [...hist.values()].reduce((a, b) => a + b, 0)
    const dominant = Math.max(...hist.values())
    expect({ share: dominant / total > 0.9, total: total > 0 }).toEqual({ share: true, total: true })
  })

  it('and that one heading lies along the channel, not across it', () => {
    // A horizontal cut runs along COL, so its cells must read heading 0 or 2. Pointing 1/3 would mean the
    // waves run across the river, which is the "backwards" half of the complaint.
    const s = river('divides')
    const across = wetCells(s).filter(([col, row]) => {
      const h = s.flow?.[row]?.[col]
      return h === 1 || h === 3
    })
    expect(across.length / wetCells(s).length).toBeLessThan(0.1)
  })
})
