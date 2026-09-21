/**
 * A MAP COMES BACK THE SHAPE IT WENT IN.
 *
 *     bin/e2e loadKeepsShape          (via bin/e2e)
 *
 *     the z-width is not applied on load, but if I modify any of the values, it changes correctly
 *
 * That "but" is the whole shape of the bug: the value is in the database, the editor can act on it, and
 * only the first draw after a load is wrong. A round-trip gate that compares the API's JSON against what
 * was sent will pass on a map that renders wrong, because the JSON is fine. So this compares the GRID
 * the engine is holding before the save against the GRID it is holding after the reload, which is the
 * thing the renderer actually reads.
 *
 * It counts the floors separately for the same reason. A floor is a tile like any other, but the grid
 * has to know which tiles are floors to answer "what is the ground here", and that is carried by the
 * placement's own type rather than by any column. Losing it is invisible in the payload.
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
const scratchId = await openScratchMap(page, BASE, { cols: 40, rows: 40, name: 'e2e load keeps shape' })

await page.selectOption('select', 'city').catch(() => {})
await page.waitForTimeout(600)

// WAIT FOR THE CONTROL, not for a guess at how long booting takes. The editor builds its world only
// once the catalogue and the schema have landed, so how long that is depends on the machine.
const generator = page.getByRole('button', { name: /^Woodland/ }).first()
await generator.waitFor({ state: 'visible', timeout: 30000 }).catch(async () => {
  const seen = await page.evaluate(() => ({
    text: document.body.innerText.slice(0, 400),
    buttons: [...document.querySelectorAll('button')].slice(0, 12).map(b => b.textContent?.trim()),
  }))
  console.log('ON SCREEN:', JSON.stringify(seen, null, 1))
  throw new Error(`the generator never appeared. Page errors: ${pageErrors.slice(0, 3).join(' | ') || 'none'}`)
})
await generator.click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Build this world/ }).click()
await page.waitForTimeout(8000)

// What the engine is holding, reduced to the fields that decide how a tile is DRAWN.
const snapshot = () =>
  page.evaluate(() => {
    const grid = window.__nebulithGrid
    if (!grid) return null
    // EVERY FIELD THAT DECIDES A DRAW, not just the geometry.
    //
    // The first version compared size and span only, and passed on a map where the ornaments came back
    // as boxes and the road markings came back full size, because what those two lose is `settings`
    // and `pose`. A gate that checks a subset reports on that subset, and reads as "the map round
    // trips" to anybody skimming it.
    const shape = a => [
      a.col, a.row, a.label ?? a.tileKey ?? a.type, a.heightLevel ?? 0,
      a.height, a.width, a.depth,
      a.spanForward, a.spanAxis, a.spanBack, a.spanPerp, a.spanPerpBack,
      // IN A FIXED ORDER. `JSON.stringify` preserves insertion order, so the same four reaches written
      // in a different sequence compared unequal and the gate reported a round-trip failure on a tile
      // that round-tripped perfectly.
      ['left-up', 'right-up', 'left-down', 'right-down'].map(d => a.thickness?.[d] ?? '-').join(','),
      // How it is drawn: one billboard or painted on every face, and whether the block shell shows.
      a.settings?.display ?? '-', a.settings?.transparent ?? '-',
      a.settings?.fadeNear ?? '-', a.settings?.cutawayRoof ?? '-', a.settings?.actAsTile ?? '-',
      // Where it sits inside its own cell, and how big its picture is drawn.
      // Compared by what it DOES, not by which keys happen to be present: an absent pose and an
      // identity one are the same instruction to a renderer, and the placement carries whichever the
      // path it came down happened to build.
      JSON.stringify({ dx: a.pose?.dx ?? 0, dy: a.pose?.dy ?? 0, rot: a.pose?.rot ?? 0, flip: a.pose?.flip === true, scale: a.pose?.scale ?? 1 }),
      a.shape ?? '-', a.zIndex ?? '-', a.opacity ?? '-', a.brightness ?? '-',
      // Whether it MOVES, and from when. A fountain that stops animating after a reload looks like a
      // rendering bug and is a missing column.
      a.animations ? JSON.stringify(a.animations) : '-', a.placedAt ?? '-',
      a.color ?? '-', a.sideColor ?? '-',
    ].join('|')
    return {
      total: grid.assets.length,
      floors: grid.assets.filter(a => a.type === 'floor').length,
      spanning: grid.assets.filter(a => (a.spanForward ?? 1) > 1).length,
      single: grid.assets.filter(a => a.settings?.display === 'single').length,
      posed: grid.assets.filter(a => a.pose && ((a.pose.dx ?? 0) || (a.pose.dy ?? 0) || (a.pose.rot ?? 0) || a.pose.flip === true || (a.pose.scale ?? 1) !== 1)).length,
      animated: grid.assets.filter(a => a.animations?.length).length,
      shapes: grid.assets.map(shape).sort(),
    }
  })

// PLANT WHAT MUST SURVIVE, rather than hoping the generator planted it.
//
// The animation check asserted that at least one animated tile made the round trip, and whether a
// generated woodland contains a fountain is up to the generator that day: the gate passed for a week
// and then failed on a map with no moving water in it. A gate that depends on what the dice rolled is
// testing the dice.
await page.evaluate(() => {
  const grid = window.__nebulithGrid
  const stamp = window.__nebulithStamp
  if (stamp && grid) stamp(grid, 'fountain', 2, 2, 'spring', 0, 0, {}, 0)
})
await page.waitForTimeout(1200)

const before = await snapshot()
if (!before) check(false, 'the grid is on the page')

await page.getByLabel(/Save (map|template)/).first().click()
await page.waitForTimeout(4000)

// A REAL RELOAD. Re-rendering from the objects still in memory would prove nothing about loading.
await page.goto(`${BASE}/templates?id=${scratchId}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(6000)

const after = await snapshot()

if (before && after) {
  console.log(`\nbefore  ${before.total} tiles, ${before.floors} floors, ${before.spanning} spanning, ${before.single} single, ${before.posed} posed, ${before.animated} animated`)
  console.log(`after   ${after.total} tiles, ${after.floors} floors, ${after.spanning} spanning, ${after.single} single, ${after.posed} posed, ${after.animated} animated\n`)

  check(after.total === before.total, 'the map comes back with every tile', `${before.total} saved, ${after.total} loaded`)
  check(
    after.floors === before.floors,
    'the ground comes back as ground',
    `${before.floors} floors saved, ${after.floors} loaded`,
  )
  check(
    after.spanning === before.spanning,
    'every z-width span comes back applied',
    `${before.spanning} spanning tiles saved, ${after.spanning} loaded`,
  )
  check(
    after.single === before.single,
    'a tile drawn as one billboard comes back as one billboard, not painted on every face',
    `${before.single} single saved, ${after.single} loaded`,
  )
  check(
    after.animated === before.animated && after.animated > 0,
    'every animated tile comes back animated',
    `${before.animated} animated saved, ${after.animated} loaded`,
  )
  check(
    after.posed === before.posed,
    'a tile nudged or resized inside its cell comes back where it was put',
    `${before.posed} posed saved, ${after.posed} loaded`,
  )

  // Both sides, side by side. A one-sided dump of "what was saved" cannot tell a lost value from a
  // gained one, and the two call for opposite fixes.
  const diffs = []
  for (let i = 0; i < Math.max(before.shapes.length, after.shapes.length) && diffs.length < 4; i++) {
    if (before.shapes[i] === after.shapes[i]) continue
    diffs.push(`\n    saved   ${before.shapes[i] ?? '(nothing)'}\n    loaded  ${after.shapes[i] ?? '(nothing)'}`)
  }
  check(
    after.shapes.length === before.shapes.length && diffs.length === 0,
    'every tile comes back the same shape',
    diffs.join(''),
  )
}

await dropScratchMap(page, scratchId)
await browser.close()

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed')
process.exit(failures.length ? 1 : 0)
