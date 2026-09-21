/**
 * WHAT A GENERATED TILE IS SHAPED LIKE, read off the real grid after a real build.
 *
 *     bin/e2e tileShapes            (via bin/e2e)
 *
 * Three shapes were reported wrong at once, and all three are the same mistake: a thing that should have
 * been said with THICKNESS and HEIGHT was said with something else, or not said at all.
 *
 *   A FLOOR IS FLAT. Terrain is height 0 in the catalogue. A floor placement that states no height is not
 *   "left to the tile", it is the column's default of one whole block, so the water and the grass came up
 *   as a field of cubes.
 *
 *   A DOOR IS TALL AND THIN ON ONE SIDE. Two blocks high, hugging the wall it sits in. Thin on all four
 *   sides is a post in a doorway, not a door.
 *
 *   A TRUNK IS THIN BY THICKNESS, NOT BY WIDTH. "do not modify their width, modify their thickness and
 *   height". Width is how many cells across a tile is; a trunk is one cell across and mostly air, which
 *   is what thickness means.
 *
 * It reads the placements rather than the pixels, because these are all settings: the question is what
 * the generator WROTE, and a screenshot cannot tell a thin block from a small one.
 */
import { chromium } from 'playwright'
import { BASE } from './base.mjs'
import { logIn } from './logIn.mjs'
import { openScratchMap, dropScratchMap } from './scratchMap.mjs'

const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`)
  if (!ok) failures.push(label)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

// SAY WHY, when the editor does not come up. A gate that only reports "the button was not there" sends
// you looking at the button; the reason is almost always a throw during boot.
const pageErrors = []
page.on('pageerror', e => pageErrors.push(e.message.split('\n')[0]))

await logIn(page, BASE)
const scratchId = await openScratchMap(page, BASE, { cols: 60, rows: 60, name: 'e2e tile shapes' })

// A TOWN, so there are doors, and a wilderness generator would give none.
await page.selectOption('select', 'city').catch(() => {})
await page.waitForTimeout(600)

// WAIT FOR THE CONTROL, not for a guess at how long booting takes. The editor builds its world only
// once the catalogue and the schema have landed, so how long that is depends on the machine.
const generator = page.getByRole('button', { name: /^Woodland/ }).first()
await generator.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {
  throw new Error(`the generator never appeared. Page errors: ${pageErrors.slice(0, 3).join(' | ') || 'none'}`)
})
await generator.click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Build this world/ }).click()
await page.waitForTimeout(9000)

const shapes = await page.evaluate(() => {
  const grid = window.__nebulithGrid
  if (!grid) return null
  const of = a => ({
    label: a.label ?? a.tileKey ?? a.type,
    type: a.type,
    height: a.height,
    width: a.width,
    depth: a.depth,
    reaches: a.thickness ? Object.entries(a.thickness).filter(([, v]) => typeof v === 'number' && v > 0) : [],
    spanForward: a.spanForward,
    spanAxis: a.spanAxis,
  })
  const all = grid.assets.map(of)
  const pick = re => all.filter(a => re.test(String(a.label)))
  return {
    total: all.length,
    // THE GROUND IS THE FLOOR TYPE, not a list of labels that look like ground. Matching `/^road/`
    // swept up `road_marking_along_row`, which is a regular tile painted on the road and has every
    // right to stand a block tall, and the gate then reported the map broken because the probe was.
    floors: all.filter(a => a.type === 'floor'),
    doors: pick(/^door/),
    // The tree factory's trunk. `tree_dead` stacks whole cubes and is a different silhouette.
    trunks: pick(/^trunk_mid/),
    // Roofs, which are the z-width case: a roof column is authored as ONE tile spanning several cells.
    roofs: pick(/^roof/),
  }
})

if (!shapes) {
  check(false, 'the grid is on the page')
} else {
  console.log(`\n${shapes.total} placements: ${shapes.floors.length} ground, ${shapes.doors.length} doors, ${shapes.trunks.length} trunks\n`)

  // 1. GROUND LIES FLAT.
  check(shapes.floors.length > 0, 'the world has ground in it')
  const tallFloors = shapes.floors.filter(f => (f.height ?? 1) !== 0)
  check(
    tallFloors.length === 0,
    'every ground tile is height 0, the height its catalogue row states',
    `${tallFloors.length} of ${shapes.floors.length} are not, e.g. ${JSON.stringify(tallFloors[0] ?? null)}`,
  )

  // 2. A DOOR IS TWO BLOCKS TALL AND THIN ON ONE SIDE.
  check(shapes.doors.length > 0, 'the town has doors in it')
  const shortDoors = shapes.doors.filter(d => d.height !== 2)
  check(shortDoors.length === 0, 'every door is 2 blocks tall', `${shortDoors.length} are not, e.g. ${JSON.stringify(shortDoors[0] ?? null)}`)

  const badReach = shapes.doors.filter(d => d.reaches.length !== 1)
  check(
    badReach.length === 0,
    'every door is thin on exactly ONE side, not squeezed from all four',
    `${badReach.length} are not, e.g. ${JSON.stringify(badReach[0] ?? null)}`,
  )

  // 3. A TRUNK IS THIN BY THICKNESS.
  check(shapes.trunks.length > 0, 'the world has trees in it')
  const squashed = shapes.trunks.filter(t => typeof t.width === 'number' && t.width !== 1)
  check(
    squashed.length === 0,
    'no trunk is made thin by shrinking its width',
    `${squashed.length} are, e.g. ${JSON.stringify(squashed[0] ?? null)}`,
  )

  const flatDepth = shapes.trunks.filter(t => typeof t.depth === 'number' && t.depth !== 1)
  check(
    flatDepth.length === 0,
    'no trunk is made thin by shrinking its depth either',
    `${flatDepth.length} are, e.g. ${JSON.stringify(flatDepth[0] ?? null)}`,
  )

  const noReach = shapes.trunks.filter(t => t.reaches.length === 0)
  check(
    noReach.length === 0,
    'every trunk states its thinness as thickness',
    `${noReach.length} state none, e.g. ${JSON.stringify(noReach[0] ?? null)}`,
  )

  const stubby = shapes.trunks.filter(t => (t.height ?? 0) < 1)
  check(stubby.length === 0, 'every trunk is at least a block tall', `${stubby.length} are not`)

  // A trunk is thin, and the species are NOT all thin the same way. The authored spread is the thing
  // that reads as a forest rather than as one tree stamped over and over.
  const faces = [...new Set(shapes.trunks.map(t => t.reaches[0]?.[1]).filter(v => typeof v === 'number'))]
  check(
    faces.length > 1,
    'the trunks are not all the same width, the authored spread survives',
    `${faces.length} distinct widths: ${faces.slice(0, 6).map(f => f.toFixed(3)).join(', ')}`,
  )

  // 4. A ROOF SPANS ITS CELLS.
  //
  // A roof column is authored as one tile reaching across several cells, and it drew as a row of
  // separate blocks for as long as the axis was read from a key no row has ever had.
  check(shapes.roofs.length > 0, 'the town has roofs on it')
  const spanning = shapes.roofs.filter(r => (r.spanForward ?? 1) > 1)
  check(
    spanning.length > 0,
    'roofs span their cells as one tile, rather than one block per cell',
    `${spanning.length} of ${shapes.roofs.length} span, e.g. ${JSON.stringify(spanning[0] ?? null)}`,
  )
}

await dropScratchMap(page, scratchId)
await browser.close()

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed')
process.exit(failures.length ? 1 : 0)
