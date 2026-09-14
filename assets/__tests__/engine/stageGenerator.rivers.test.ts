/**
 * THE RIVER'S COURSE.
 *
 * Each course has a SIGNATURE, and the tests assert the signature rather than the pixels:
 *   · through — reaches two opposite edges, and is crossable in several places
 *   · divides — runs edge to edge across the middle, crossable in exactly ONE place; take that crossing away
 *               and the map falls into two halves
 *   · around  — runs round the map inset from its edges, leaving the way in open
 *   · random  — one of those three, picked per seed, and genuinely more than one across seeds
 *
 * And one thing no course may do, whatever it looks like: make its CHANNEL walkable past the shallows.
 *
 * A POOL IS NOT A CHANNEL, and this file used to treat them as one thing. with A channel is CUT below the walking
  * floor, which is what makes it something you go around.
 * A pool sits at ground level and you walk through it.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { FLAT_FLOOR, generateStage } from '@/engine/stageGenerator'
// THE RIVER OWNS ITS OWN VOCABULARY NOW: the course resolver moved to `riverNetwork` with the rest of
// the channel, so the test asks the module that answers rather than the file it used to live in.
import { resolveCrossing, resolveRiverCourse } from '@/engine/riverNetwork'
import { groundTileColor } from '@/engine/tileset/groundColor'
import { findGenerator, parseGeneratorCatalog, type GeneratorCrossing, type GeneratorOptionValue } from '@/lib/generatorCatalog'
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
/** The same, crossed on one KIND of crossing (the `bridge` option), with the template's served crossings. */
function growKind(layout: 'woodland' | 'meadow' | 'jungle', river: GeneratorOptionValue, bridge: string, seed = 5) {
  const config = findGenerator(CATALOG, 'forest', layout)!.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout, cols: 60, rows: 40,
      nature: config.nature, palette: config.palette, formation: config.formation,
      treeMix: config.trees, subZones: config.subZones, crossings: config.crossings,
      options: { river, crossing: false, bridge },
    })
  } finally {
    Math.random = orig
  }
}
type Stage = ReturnType<typeof grow>

/** Every water label the generator writes: plain water, and the shallow and deep bands of the depth pass. */
/** WATER-GROUND, not a list of its names. This was a hand-written Set and it silently stopped seeing swamp
 *  pools the moment they began laying `water_still`, which is the exact failure the generator carries a comment
 *  about twenty lines from where it colours them: ask what the ground IS, never which of its names it wears. */
const isWater = (g: string): boolean => g.includes('water') || g === 'oasis' || g === 'koi'
const waterCells = (s: Stage): Array<[number, number]> => {
  const out: Array<[number, number]> = []
  s.ground.forEach((row, r) => row.forEach((g, c) => { if (isWater(g)) out.push([c, r]) }))
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

describe('water by depth: wade the shallows, the rest blocks', () => {
  // The one kind of water you may walk is the SHALLOW edge; everything past it blocks.
  it.each(['through', 'divides', 'around', 'random'])('%s: only the shallow band is walkable', course => {
    for (const layout of ['woodland', 'meadow', 'jungle'] as const) {
      const s = grow(layout, course, 3)
      // THE CHANNEL ONLY. A jungle also carries swamp pools, and a pool at ground level is walkable on purpose
      // now, so counting it here measured the wrong thing. Pools are the cells wearing the served swamp tone.
      const pal = findGenerator(CATALOG, 'forest', layout)!.config.palette
      const channel = waterCells(s).filter(([c, r]) => !(pal?.swamp && s.floorColors[r][c] === pal.swamp))
      const walkableDeep = channel.filter(([c, r]) => s.ground[r][c] !== 'water_shallow' && !s.collision[r][c])
      const blockedShallow = channel.filter(([c, r]) => s.ground[r][c] === 'water_shallow' && s.collision[r][c])
      expect({ layout, course, walkableDeep: walkableDeep.length, blockedShallow: blockedShallow.length })
        .toEqual({ layout, course, walkableDeep: 0, blockedShallow: 0 })
    }
  })

  it('a wide river is shallow at the edge and deep in the middle, and still divides the map', () => {
    const s = grow('woodland', 'divides', 2)
    const labels = new Set(waterCells(s).map(([c, r]) => s.ground[r][c]))
    expect([...labels].sort()).toEqual(['water', 'water_deep', 'water_shallow'])
    // wading the edges does not get you across. The middle still blocks, so the one crossing is still THE way
    expect(crossings(s)).toBe(1)
    expect(regionSizes(s, deckCells(s)).filter(n => n > 40).length).toBeGreaterThanOrEqual(2)
  })

  /**
   * ONE SURFACE COLOUR for the whole channel.
   *
   * after
   *
   * THIS REPLACES what this case used to pin (shallow light, deep dark), which came from his 2026-09-11
   * The
   * newer instruction wins, and the measurement says why: one seed-2 `divides` river carried `#4f93b3`,
   * `#8ccbe8` and `#2a5f8a` at once. All three bands draw the SAME picture, because a floor resolves its art
   * through `groundKind`, which collapses every water label to `water`. So the three tones were three tints on
   * one tile, never three kinds of water.
   *
   * The assertion is DIFFERENTIAL on purpose: the bands must still be MORE than one (they carry the label and
   * decide what you can wade) while the tones must be exactly one. Collapsing the bands themselves, the wrong
   * fix, would fail the first expectation rather than quietly pass.
   */
  it('paints the WHOLE channel one served tone, whatever the band', () => {
    const pal = findGenerator(CATALOG, 'forest', 'woodland')!.config.palette!
    const s = grow('woodland', 'divides', 2)
    const channel = waterCells(s).filter(([c, r]) => !(pal.swamp && s.floorColors[r][c] === pal.swamp))
    expect([...new Set(channel.map(([c, r]) => s.floorColors[r][c]))]).toEqual([pal.water])
    expect(new Set(channel.map(([c, r]) => s.ground[r][c])).size).toBeGreaterThan(1)
  })

  /**
   * A POOL IS WALKABLE, and it used to be blocked.
   *
   * The cause was that `waterDepth` skips pool cells (`!pools.has(...)`), so a pool never reached the depth
   * bands that decide walkability and kept the flat block `floodSwampPools` stamped. The river's shallows went
   * through the bands and were wadeable; the pool beside them never did. Same water, two rules.
   */
  it('a swamp pool is WALKABLE and still turns blue-green, never the floor-green it used to be', () => {
    // A POOL IS A FILM NOW, not a ground tile. It stopped replacing the ground on 2026-09-13 because its own
    // height could never match the floor it landed on, so a drop happened into every one of them. The pool
    // is therefore a prop carrying the swamp tone, sitting over ground that is left alone.
    const config = findGenerator(CATALOG, 'forest', 'jungle')!.config
    const s = grow('jungle', 'none', 7)
    const pools = s.props.filter(p => p.label === 'water_still')
    expect(pools.length).toBeGreaterThan(0)
    expect(pools.every(p => p.color === config.palette!.swamp)).toBe(true)
    expect(pools.every(p => !s.collision[p.row][p.col])).toBe(true)
    // …and the GROUND under it is untouched, which is the whole point of the change.
    expect(pools.every(p => !s.ground[p.row][p.col].includes('water'))).toBe(true)
  })

  /**
   * FROZEN OVER. The ice physics do not exist
   * yet; walking over it does.
   */
  it('a WINTER river is ice, and you walk over it', () => {
    const config = findGenerator(CATALOG, 'forest', 'woodland')!.config
    const orig = Math.random
    Math.random = makeRng(5)
    const s = (() => {
      try {
        return generateStage({
          zone: 'winter', variant: 'forest', layout: 'woodland', cols: 60, rows: 40,
          nature: config.nature, palette: config.palette, formation: config.formation,
          treeMix: config.trees, options: { river: 'divides', crossing: false },
        })
      } finally { Math.random = orig }
    })()
    // Scanned by the ICE label, not through `waterCells`: that helper matches the channel's three labels
    // (`water` / `water_shallow` / `water_deep`) and so cannot see a frozen river at all.
    const ice: Array<[number, number]> = []
    s.ground.forEach((row, r) => row.forEach((t, c) => { if (t === 'frozen_water') ice.push([c, r]) }))
    expect(ice.length).toBeGreaterThan(0)
    // The whole course freezes: no cell is left as OPEN water. `waterCells` asks what the ground IS now, and
    // frozen water IS water, so the question has to be asked precisely rather than relying on a name list that
    // happened to omit `frozen_water`.
    const open = waterCells(s).filter(([c, r]) => s.ground[r][c] !== 'frozen_water')
    expect(open).toEqual([])
    expect(ice.every(([c, r]) => !s.collision[r][c])).toBe(true)
  })

  it('and a SUMMER river still blocks past its shallows, so the season is the only difference', () => {
    const s = grow('woodland', 'divides', 5)
    const deep = waterCells(s).filter(([c, r]) => s.ground[r][c] === 'water_deep')
    expect(deep.length).toBeGreaterThan(0)
    expect(deep.every(([c, r]) => s.collision[r][c])).toBe(true)
  })
})

describe('the kind of crossing: a dirt path, or one of several bridges', () => {
  // bridges" that we use on rivers, we must have multiple variations too / it can be a simple dirt path, it can be an
  // actual bridge, which again, are multiple variations"*.
  const kinds = (layout: 'woodland' | 'meadow' | 'jungle') => findGenerator(CATALOG, 'forest', layout)!.config.crossings!
  const deckOf = (s: Stage, style: GeneratorCrossing): Set<string> => {
    const out = new Set<string>()
    s.ground.forEach((row, r) => row.forEach((g, c) => {
      if (g !== style.tile) return
      if (style.colorOf && s.floorColors[r][c] !== groundTileColor(style.colorOf, c, r)) return
      out.add(`${c},${r}`)
    }))
    return out
  }

  it('serves a dirt path and at least three bridges, every one naming its tile', () => {
    const served = kinds('woodland')
    expect(served.dirt).toEqual({ tile: FLAT_FLOOR, colorOf: 'path_dirt' })
    expect(Object.keys(served).length).toBeGreaterThanOrEqual(4)
    expect(Object.values(served).every(k => typeof k.tile === 'string' && k.tile.length > 0)).toBe(true)
  })

  it.each(['dirt', 'wood', 'planks', 'stone'])('%s: every deck is that kind, and the map is still one place', kind => {
    for (const layout of ['woodland', 'meadow', 'jungle'] as const) {
      const style = kinds(layout)[kind]
      const s = growKind(layout, 'divides', kind, 2)
      expect({ layout, kind, decks: deckOf(s, style).size > 0 }).toEqual({ layout, kind, decks: true })
      if (style.tile !== 'bridge') expect({ layout, kind, classic: s.ground.flat().filter(g => g === 'bridge').length }).toEqual({ layout, kind, classic: 0 })
      expect({ layout, kind, regions: regionSizes(s).length }).toEqual({ layout, kind, regions: 1 })
    }
  })

  it('a dirt path is the flat floor in the dirt path colour, and it still divides like a bridge does', () => {
    const style = kinds('woodland').dirt
    const s = growKind('woodland', 'divides', 'dirt', 2)
    const deck = deckOf(s, style)
    expect(deck.size).toBeGreaterThan(0)
    // take the path away and the river splits the map, so the path IS the crossing, not a gap in the water
    expect(regionSizes(s, deck).filter(n => n > 40).length).toBeGreaterThanOrEqual(2)
  })

  it('random picks among the kinds, and more than one across maps', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const s = growKind('woodland', 'divides', 'random', seed)
      for (const [key, style] of Object.entries(kinds('woodland'))) if (deckOf(s, style).size > 0) seen.add(key)
    }
    expect(seen.size).toBeGreaterThanOrEqual(2)
  })

  it('an older recipe with no kind keeps the classic deck, so a saved map does not change', () => {
    expect(resolveCrossing(undefined, kinds('woodland'), makeRng(1))).toBeUndefined()
    expect(resolveCrossing('stone', undefined, makeRng(1))).toBeUndefined()
    expect(resolveCrossing('stone', kinds('woodland'), makeRng(1))).toEqual(kinds('woodland').stone)
  })
})
