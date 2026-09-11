/**
 * THE RIVER'S COURSE.
 *
 * Alexander, 2026-09-11: *"the rivers aren't consistently generated, It'd like to have variants of river
 * usage, maybe it's traversable, maybe it's dividing the map in two half, maybe it's around the map, etc
 * right now is super random, and while I want and think the randomness is good, we need to parametize it a
 * bit more"*.
 *
 * Each course has a SIGNATURE, and the tests assert the signature rather than the pixels:
 *   · through — reaches two opposite edges, and is crossable in several places
 *   · divides — runs edge to edge across the middle, crossable in exactly ONE place; take that crossing away
 *               and the map falls into two halves
 *   · around  — runs round the map inset from its edges, leaving the way in open
 *   · random  — one of those three, picked per seed, and genuinely more than one across seeds
 *
 * And one thing no course may do, whatever it looks like: make water walkable.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, resolveRiverCourse } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog, type GeneratorOptionValue } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

/** Build a forest from its REAL served config, with the river switched to a course. */
function grow(layout: 'woodland' | 'meadow' | 'jungle', river: GeneratorOptionValue, seed = 5, crossing = false) {
  const config = findGenerator(CATALOG, 'forest', layout)!.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout, cols: 60, rows: 40,
      nature: config.nature, palette: config.palette, formation: config.formation,
      treeMix: config.trees, subZones: config.subZones, options: { river, crossing },
    })
  } finally {
    Math.random = orig
  }
}
type Stage = ReturnType<typeof grow>

const waterCells = (s: Stage): Array<[number, number]> => {
  const out: Array<[number, number]> = []
  s.ground.forEach((row, r) => row.forEach((g, c) => { if (g === 'water') out.push([c, r]) }))
  return out
}

const edges = (s: Stage) => {
  const w = waterCells(s)
  return {
    top: w.some(([, r]) => r === 0),
    bottom: w.some(([, r]) => r === s.rows - 1),
    left: w.some(([c]) => c === 0),
    right: w.some(([c]) => c === s.cols - 1),
  }
}

/** Separate crossings: each connected group of deck cells is one place you can get over. */
function crossings(s: Stage): number {
  const deck = new Set<string>()
  s.ground.forEach((row, r) => row.forEach((g, c) => { if (g === 'bridge') deck.add(`${c},${r}`) }))
  const seen = new Set<string>()
  let n = 0
  for (const start of deck) {
    if (seen.has(start)) continue
    n++
    const stack = [start]
    seen.add(start)
    while (stack.length) {
      const [c, r] = stack.pop()!.split(',').map(Number)
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${c + dc},${r + dr}`
        if (deck.has(k) && !seen.has(k)) { seen.add(k); stack.push(k) }
      }
    }
  }
  return n
}

/** Walkable region sizes, largest first, optionally pretending some cells are blocked. 4-neighbour: the top
 *  view moves orthogonally, so a map has to be connected that way to be walkable in every view. */
function regionSizes(s: Stage, block = new Set<string>()): number[] {
  const ok = (c: number, r: number) =>
    r >= 0 && r < s.rows && c >= 0 && c < s.cols && !s.collision[r][c] && !block.has(`${c},${r}`)
  const seen = new Set<string>()
  const sizes: number[] = []
  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) {
      if (!ok(c, r) || seen.has(`${c},${r}`)) continue
      let n = 0
      const stack: Array<[number, number]> = [[c, r]]
      seen.add(`${c},${r}`)
      while (stack.length) {
        const [cc, rr] = stack.pop()!
        n++
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = cc + dc
          const nr = rr + dr
          if (ok(nc, nr) && !seen.has(`${nc},${nr}`)) { seen.add(`${nc},${nr}`); stack.push([nc, nr]) }
        }
      }
      sizes.push(n)
    }
  }
  return sizes.sort((a, b) => b - a)
}

const deckCells = (s: Stage) => {
  const out = new Set<string>()
  s.ground.forEach((row, r) => row.forEach((g, c) => { if (g === 'bridge') out.add(`${c},${r}`) }))
  return out
}

describe('no river means no river', () => {
  it.each(['woodland', 'meadow'] as const)('a %s with the river set to none has no water at all', layout => {
    expect(waterCells(grow(layout, 'none'))).toHaveLength(0)
  })

  it('a jungle still has its creek — the option says what KIND of water, not whether a jungle has any', () => {
    expect(waterCells(grow('jungle', 'none')).length).toBeGreaterThan(0)
  })
})

describe('through — winds across, and is easy to cross', () => {
  it.each([1, 2, 3, 4])('seed %i reaches two opposite edges and is crossable in several places', seed => {
    const s = grow('woodland', 'through', seed)
    const e = edges(s)
    expect((e.top && e.bottom) || (e.left && e.right)).toBe(true)
    expect(crossings(s)).toBeGreaterThanOrEqual(2)
    expect(regionSizes(s)).toHaveLength(1)
  })
})

describe('divides — cuts the map in two, crossable in ONE place', () => {
  it.each([1, 2, 3, 4])('seed %i runs edge to edge with exactly one crossing', seed => {
    const s = grow('woodland', 'divides', seed)
    const e = edges(s)
    expect(e.left && e.right).toBe(true)
    expect(crossings(s)).toBe(1)
    expect(regionSizes(s)).toHaveLength(1)
  })

  it('take the crossing away and the map falls into two halves — that is what "divides" means', () => {
    const s = grow('woodland', 'divides', 2)
    const halves = regionSizes(s, deckCells(s)).filter(n => n > 40)
    expect(halves.length).toBeGreaterThanOrEqual(2)
  })
})

describe('around — runs round the map and leaves the way in open', () => {
  it('hugs the far edge and both sides, keeps the near edge open, and is bridged once', () => {
    // Its wobble can brush the map edge — the old meadow river always could — so the signature is WHICH sides
    // it follows, not that it never touches an edge.
    const s = grow('woodland', 'around')
    const w = waterCells(s)
    const band = 8
    expect(w.some(([, r]) => r < band)).toBe(true)
    expect(w.some(([c]) => c < band)).toBe(true)
    expect(w.some(([c]) => c >= s.cols - band)).toBe(true)
    // The way in stays open. The side arms run all the way down the map, so "open" means nothing crosses the
    // near edge BETWEEN them, not that the bottom rows hold no water at all.
    const arm = 12
    expect(w.some(([c, r]) => r >= s.rows - 3 && c >= arm && c < s.cols - arm)).toBe(false)
    expect(crossings(s)).toBe(1)
    expect(regionSizes(s)).toHaveLength(1)
  })

  it('an old saved recipe with river: true still gets exactly the river it always had', () => {
    // A map saved before the course existed must not change under anyone.
    const key = (s: Stage) => s.ground.map(r => r.join('')).join('|') + s.collision.map(r => r.map(Number).join('')).join('|')
    expect(key(grow('woodland', true))).toBe(key(grow('woodland', 'around')))
  })
})

describe('random — one of the courses, and more than one across seeds', () => {
  // Tested as a DISTRIBUTION through the resolver, not guessed from what a map happens to look like: two
  // different "through" maps also look different, so comparing pictures cannot prove the course varied.
  it('resolves to each of the three courses over enough rolls', () => {
    const rand = makeRng(11)
    const seen = new Set(Array.from({ length: 40 }, () => resolveRiverCourse('random', 'around', rand)))
    expect([...seen].sort()).toEqual(['around', 'divides', 'through'])
  })

  it('named courses resolve to themselves, none and junk to nothing, an old true to the layout\'s own', () => {
    const rand = makeRng(1)
    expect(resolveRiverCourse('divides', 'around', rand)).toBe('divides')
    expect(resolveRiverCourse('none', 'around', rand)).toBeNull()
    expect(resolveRiverCourse(undefined, 'around', rand)).toBeNull()
    expect(resolveRiverCourse('nonsense', 'around', rand)).toBeNull()
    expect(resolveRiverCourse(true, 'through', rand)).toBe('through')
  })

  it('every random map has a river and is one place', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = grow('woodland', 'random', seed)
      expect(waterCells(s).length).toBeGreaterThan(0)
      expect({ seed, regions: regionSizes(s).length }).toEqual({ seed, regions: 1 })
    }
  })
})

describe('whatever the course, water is never walkable', () => {
  // The bug this guards: the region join used to run before the river was bridged, saw the far bank as a
  // stray region, and cut a track straight across the water — a walkable stripe through the river.
  it.each(['through', 'divides', 'around', 'random'])('%s leaves every water cell blocked', course => {
    for (const layout of ['woodland', 'meadow', 'jungle'] as const) {
      const s = grow(layout, course, 3)
      const walkableWater = waterCells(s).filter(([c, r]) => !s.collision[r][c])
      expect({ layout, course, walkableWater: walkableWater.length }).toEqual({ layout, course, walkableWater: 0 })
    }
  })
})
