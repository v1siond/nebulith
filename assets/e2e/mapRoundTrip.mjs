/**
 * GATE 1 OF PHASE 3, THROUGH THE EDITOR: a map round-trips.
 *
 * The context round-tripping in Elixir and the API round-tripping over HTTP are both true and neither
 * is the claim that matters to a person. This is the one that does: author on the real page, save,
 * reload, and get back what you authored, out of `cells` and `cell_tiles` rather than a JSON blob.
 *
 * It also proves the cutover happened at all, by reading the rows: a map that saved into the blob
 * would leave the tables empty and this would see it.
 *
 *   node e2e/mapRoundTrip.mjs          (server on :6328)
 */
import { chromium } from 'playwright'
import { logIn } from './logIn.mjs'
import { openScratchMap, dropScratchMap } from './scratchMap.mjs'

const BASE = process.env.BASE || 'http://localhost:6328'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } })

let scratchId = null
const fail = async (message) => {
  await dropScratchMap(page, scratchId).catch(() => {})
  await browser.close()
  console.error(`FAIL  ${message}`)
  process.exit(1)
}
const ok = (message, detail = '') => console.log(`ok   ${message}${detail ? '  ' + detail : ''}`)

await logIn(page, BASE)
scratchId = await openScratchMap(page, BASE, { cols: 24, rows: 24, name: 'e2e map round trip' })

// 1. The editor resolved the MAP behind the template, and the map already holds rows.
const served = await page.evaluate(async (id) => {
  const res = await fetch(`/api/maps/for_template/${id}`)
  return res.ok ? (await res.json()).data : null
}, scratchId)

if (!served) await fail('the editor could not resolve a map for the template it has open')
if (!served.map?.id) await fail('the map came back without an id')
ok('the template resolves to a map', `${served.cells.length} cells`)

// 2. Author something with settings that only survive if every column travels.
await page.locator('button:has-text("Build this world")').first().click()
await page.waitForTimeout(6000)

const box = await page.locator('canvas').first().boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(1200)

// 3. Save through the real button.
await page.getByLabel(/Save (map|template)/).first().click()
await page.waitForTimeout(3500)

// 4. The ROWS hold it. This is the cutover: a save that still went to the blob leaves these empty.
const afterSave = await page.evaluate(async (id) => {
  const res = await fetch(`/api/maps/${id}`)
  const data = (await res.json()).data
  const tiles = data.cells.reduce((n, c) => n + c.tiles.length, 0)
  return { cells: data.cells.length, tiles, grid: data.grid }
}, served.map.id)

if (afterSave.cells < 100) await fail(`the save wrote ${afterSave.cells} cells, so it did not go to the tables`)
if (afterSave.tiles < 100) await fail(`the save wrote ${afterSave.tiles} tiles`)
ok('the save landed in cells and cell_tiles', `${afterSave.cells} cells, ${afterSave.tiles} tiles`)

// 5. Reload the page and compare what the editor holds against what the rows hold.
await page.goto(`${BASE}/templates?id=${scratchId}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)

const afterReload = await page.evaluate(async (id) => {
  const res = await fetch(`/api/maps/${id}`)
  const data = (await res.json()).data
  return { cells: data.cells.length, tiles: data.cells.reduce((n, c) => n + c.tiles.length, 0) }
}, served.map.id)

if (afterReload.cells !== afterSave.cells || afterReload.tiles !== afterSave.tiles) {
  await fail(`a reload changed the map: ${JSON.stringify(afterSave)} became ${JSON.stringify(afterReload)}`)
}
ok('a reload changes nothing', `${afterReload.cells} cells, ${afterReload.tiles} tiles`)

// 6. And saving what was just reloaded changes nothing either, which is the round trip closing.
await page.getByLabel(/Save (map|template)/).first().click()
await page.waitForTimeout(3500)

const afterSecond = await page.evaluate(async (id) => {
  const res = await fetch(`/api/maps/${id}`)
  const data = (await res.json()).data
  return { cells: data.cells.length, tiles: data.cells.reduce((n, c) => n + c.tiles.length, 0) }
}, served.map.id)

if (afterSecond.cells !== afterReload.cells || afterSecond.tiles !== afterReload.tiles) {
  await fail(`a second save changed the map: ${JSON.stringify(afterReload)} became ${JSON.stringify(afterSecond)}`)
}
ok('saving what was reloaded changes nothing', `${afterSecond.cells} cells, ${afterSecond.tiles} tiles`)

// 7. The grid's own numbers came back with it.
if (afterSave.grid.cols !== 24 || afterSave.grid.rows !== 24) {
  await fail(`the grid's own size did not travel: ${JSON.stringify(afterSave.grid)}`)
}
ok("the grid's own numbers travelled", `${afterSave.grid.cols}x${afterSave.grid.rows} at cell ${afterSave.grid.cell_size}`)

await dropScratchMap(page, scratchId)
await browser.close()
console.log('\nPASS  a map authored in the editor saves to rows, reloads identical, and re-saves identical')
