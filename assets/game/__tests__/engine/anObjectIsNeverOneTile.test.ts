import { readFileSync } from 'fs'
import { join } from 'path'
import tilesets from '@/__tests__/fixtures/tilesets.json'

/**
 * A THING IS A COMPOSITION, NEVER ONE TILE STOOD IN FOR IT. OBJECT-CONSTRUCTION.md.
 *
 * *"theres a bunch of templates where we made the mistake of using individual tiles as things, instead of our
 * objects, for example, we're using bulb tile instead of the lamb post"*.
 *
 * A `lamp_post` is TWO cells: a `post` at scale 0.3 and scaleY 7.0, so it draws as a pole, and a `lamp` bulb
 * at scale 0.6 with `display: single` and a pose that sits it on top. Place the `lamp` on its own and you get
 * what he photographed: a full-size yellow cube, because a tile draws as a cube shell by default and the
 * proportions that made it a bulb live on the COMPOSITION's cell, not on the tile.
 *
 * So the rule is checkable: a label that only ever exists as a PIECE of a composition must never be placed by
 * the generator as a tile in its own right.
 */
type Comp = { cells?: { tile?: string; label?: string }[] }
type Tileset = { compositions?: Record<string, Comp>; tiles?: Record<string, unknown> }

const style = ((tilesets as { data?: Tileset[] }).data ?? [])[0] ?? {}
const compositions = style.compositions ?? {}

/** Every label that appears as a cell of some composition. */
const pieceOf = new Map<string, string[]>()
for (const [name, comp] of Object.entries(compositions)) {
  for (const cell of comp.cells ?? []) {
    const label = cell.tile ?? cell.label
    if (!label) continue
    pieceOf.set(label, [...(pieceOf.get(label) ?? []), name])
  }
}

/**
 * Labels that are ONLY ever a piece. A label that is also a composition in its own right is fine: `bush` is
 * both a piece of other things and a thing you can place.
 *
 * `rock` and `door` are pieces of something bigger AND real objects on their own, a boulder and a doorway, so
 * they are named here rather than left to make the rule look broken.
 */
const STANDS_ALONE = new Set(['rock', 'door', 'water_c', 'bush'])
const pieceOnly = [...pieceOf.keys()].filter(l => !(l in compositions) && !STANDS_ALONE.has(l))

/** The generator's own source. A placement is `label:`/`tile:`/`kind:` bound to a literal. */
const SOURCES = ['engine/stageGenerator.ts', 'engine/riverNetwork.ts', 'engine/villageLayout.ts']
const source = SOURCES.map(f => {
  try { return readFileSync(join(process.cwd(), 'game', f), 'utf8') } catch { return '' }
}).join('\n')

describe('the generator places objects, not the pieces they are made of', () => {
  test('the fixture actually carries compositions, so an empty pass cannot look like success', () => {
    expect(Object.keys(compositions).length).toBeGreaterThan(20)
    expect(pieceOnly.length).toBeGreaterThan(10)
  })

  test.each(pieceOnly)('%s is never placed on its own', label => {
    const placed = new RegExp(`(?:label|tile|tileKey|kind)\\s*[:=]\\s*'${label}'`)
    const hit = placed.test(source)
    expect(hit ? `${label} is placed alone, but it is only a piece of ${pieceOf.get(label)?.join(', ')}` : '').toBe('')
  })
})
