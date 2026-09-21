/**
 * A RELOADED MAP STOPS YOU WHERE THE BUILT ONE DID.
 *
 *     node e2e/waterCollision.mjs
 *
 * *"when I generate a new world, collissions look ok, when I reload the world all collissions are gone ...
 * this map should have all collissions stored, but only the rocks are showing"*, and alongside it
 * *"I shouldn't be able to walk into ANY real water zone"*.
 *
 * So this drives the real page: build a world with a river, read what is solid, save it, load it back in a
 * FRESH page, and read what is solid again. The two have to agree, and the water cells have to be in both.
 *
 * It reads through `window.__collisionAudit`, which reports each cell's ground slug and whether the grid
 * blocks it, so the assertion is about the thing the hero actually walks into rather than about pixels.
 */
import { chromium } from 'playwright'
import { logIn } from './logIn.mjs'

const RIVER = process.argv[2] ?? 'Winds through (easy to cross)'
const LABEL = process.argv[3] ?? 'Woodland city'
const COLS = 40, ROWS = 40

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const fail = []

// ITS OWN ROW, ALWAYS. The editor's Save updates the template it currently has open, and on a database with
// one saved map that means the test overwrites the user's work. It happened once. So the run makes a blank
// template of its own first and drives the editor on that, and deletes it afterwards.
// The editor is behind a login, and the /api reads below ride the session cookie.
await logIn(page, BASE)
await page.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const scratchId = await page.evaluate(async (dims) => {
  const res = await fetch('/api/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `e2e water collision ${Date.now()}`,
      cols: dims.cols, rows: dims.rows, cellSize: 16, isoScale: 2.5,
      groundData: Array.from({ length: dims.rows }, () => Array.from({ length: dims.cols }, () => 'grass')),
      heightData: Array.from({ length: dims.rows }, () => Array.from({ length: dims.cols }, () => 0)),
      assetsData: [], connectors: [], entities: [], quests: [],
    }),
  })
  if (!res.ok) { console.log('create failed', res.status, (await res.text()).slice(0, 200)); return null }
  return (await res.json()).id
}, { cols: COLS, rows: ROWS })
if (!scratchId) {
  console.log('FAIL  could not create a scratch template, refusing to run against a real one')
  await browser.close()
  process.exit(1)
}
await page.goto(`http://localhost:6328/templates?id=${scratchId}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
const setField = async (aria, value) => {
  const f = page.getByLabel(aria, { exact: false }).first()
  if (await f.count() === 0) return
  await f.fill(String(value))
  await f.press('Enter').catch(() => {})
}
await setField('Map columns', COLS)
await setField('Map rows', ROWS)
await page.waitForTimeout(500)
await page.selectOption('select', 'city').catch(() => {})
await page.waitForTimeout(500)
await page.getByRole('button', { name: new RegExp('^' + LABEL) }).first().click()
await page.waitForTimeout(400)
// A river, or there is no water to walk into.
await page.getByRole('button', { name: new RegExp(RIVER.replace(/[()]/g, '\\$&')) }).first().click().catch(() => {})
await page.waitForTimeout(300)
await page.getByRole('button', { name: /Build this world/ }).click()
await page.waitForTimeout(8000)

const audit = async (p) => p.evaluate(() => {
  const cells = window.__collisionAudit ? window.__collisionAudit() : []
  const water = cells.filter(c => /water|oasis|koi_pond/.test(c.ground || ''))
  const openWater = water.filter(c => !c.blocked)
  return {
    total: cells.length,
    blocked: cells.filter(c => c.blocked).length,
    water: water.length,
    waterBlocked: water.filter(c => c.blocked).length,
    // Water you can walk into, split by WHY. A cell with something standing in it is a bridge deck, which is
    // meant to be crossed. A bare one is a wadeable shallow: the river's own edge, open by `wadeableShallows`.
    openDecked: openWater.filter(c => c.tiles.length > 1).length,
    openShallow: openWater.filter(c => c.tiles.length <= 1).length,
    keys: cells.filter(c => c.blocked).map(c => `${c.col},${c.row}`).sort().join('|'),
    solid: Object.fromEntries(cells.filter(c => c.blocked).map(c => [`${c.col},${c.row}`, `${c.ground}: ${c.tiles.map(t => t.label + '@' + t.level).join(' ')}`])),
  }
})

const built = await audit(page)
console.log(`built    cells ${built.total}  blocked ${built.blocked}  water ${built.water}  waterBlocked ${built.waterBlocked}  openDecked ${built.openDecked}  openShallow ${built.openShallow}`)
// A HARNESS FAULT IS NOT A TEST RESULT. A world that did not build reads as "nothing is solid", which looks
// exactly like the bug this is here to catch. It happened once, to a run that overlapped a bundle rebuild.
if (built.blocked === 0) {
  console.log('\nHARNESS  the world did not build (nothing is solid at all), so this run proves nothing. Rebuild the bundle and retry.')
  await browser.close()
  process.exit(2)
}
if (built.water === 0) fail.push('the built map has no water at all, so this run proves nothing about water')
if (built.water > 0 && built.waterBlocked === 0) fail.push('BUILT: no water cell is solid, you can walk into the river')

await page.getByRole('button', { name: /^Save/ }).first().click()
await page.waitForTimeout(4000)
const url = page.url()
console.log(`saved as ${url}`)

// A FRESH PAGE, because the bug is about loading rather than about the editor's own state.
const reloaded = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await reloaded.goto(url, { waitUntil: 'networkidle' })
await reloaded.waitForTimeout(9000)
const boxes = await reloaded.evaluate(() => ({
  rock: window.__tileBoxes?.('rock'), pillar: window.__tileBoxes?.('pillar'), water: window.__tileBoxes?.('water'),
}))
console.log(`catalog after reload: ${JSON.stringify(boxes)}`)
const back = await audit(reloaded)
console.log(`reloaded cells ${back.total}  blocked ${back.blocked}  water ${back.water}  waterBlocked ${back.waterBlocked}`)

if (back.total === 0) fail.push('RELOAD: the audit seam returned nothing, the map did not load')
if (back.water > 0 && back.waterBlocked === 0) fail.push('RELOAD: no water cell is solid, the river became walkable')
if (back.blocked < built.blocked) fail.push(`RELOAD: ${built.blocked} cells were solid when built, only ${back.blocked} after loading`)
if (back.keys !== built.keys && back.blocked >= built.blocked) fail.push('RELOAD: the same NUMBER of cells is solid but not the same cells')
const lost = Object.keys(built.solid).filter(k => !(k in back.solid))
if (lost.length > 0) {
  console.log(`\nlost on reload (${lost.length}):`)
  for (const k of lost.slice(0, 12)) console.log(`   ${k}  ${built.solid[k]}`)
}

await page.evaluate(id => fetch(`/api/templates/${id}`, { method: 'DELETE' }).catch(() => {}), scratchId)
console.log(fail.length === 0 ? '\nPASS  a reloaded map stops you where the built one did' : '\nFAIL\n  ' + fail.join('\n  '))
await browser.close()
process.exit(fail.length === 0 ? 0 : 1)
