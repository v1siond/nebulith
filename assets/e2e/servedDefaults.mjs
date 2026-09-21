/**
 * GATE 2 OF PHASE 3: no renderer reads a served value through a fallback.
 *
 * Measured on the live catalogue: `display` is stated on 26 of 636 tiles and `shape` on 0, against 116
 * places in the engine where a renderer read a served value through `?? <literal>`. So the renderers
 * held 116 opinions about what a tile looks like when nobody said, and the database held none.
 *
 * What this asserts, in the real browser, on the real page:
 *
 *   1. The engine actually LOADS the schema at boot, beside the tilesets. A default that arrives after
 *      the first frame is a frame drawn without it.
 *   2. Every settable column has a default, so there is no setting a renderer could still be forced to
 *      guess at.
 *   3. The defaults are the DATABASE's, not the engine's. Checked against /api/maps/schema itself.
 *   4. The vocabulary is served too, so a control builds its options from the column rather than from a
 *      list typed beside it.
 *   5. There is no zoom, and no walkable or blocking either.
 *
 *   bin/e2e servedDefaults          (via bin/e2e)
 */
import { chromium } from 'playwright'
import { BASE } from './base.mjs'
import { logIn } from './logIn.mjs'

const browser = await chromium.launch()
const page = await browser.newPage()

const fail = async (message) => {
  await browser.close()
  console.error(`FAIL  ${message}`)
  process.exit(1)
}

await logIn(page, BASE)
await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle' })
// attached, not visible: the mount node is a zero-size div the engine renders its canvas into.
await page.waitForSelector('#game', { state: 'attached', timeout: 20000 })

// 1. The engine holds the schema it booted with.
await page.waitForFunction(() => !!window.__nebulithTileSchema, null, { timeout: 20000 }).catch(() => {})
const loaded = await page.evaluate(() => window.__nebulithTileSchema ?? null)

if (!loaded) {
  await fail('the engine never loaded /api/maps/schema, so its defaults are still its own literals')
}

// 2 + 3. Every field has a default, and it is the one the backend serves.
const served = await page.evaluate(async (base) => {
  const res = await fetch(`${base}/api/maps/schema`)
  return (await res.json()).data
}, BASE)

const missing = served.fields.filter((f) => !(f in loaded.defaults))
if (missing.length) {
  await fail(`no default for ${missing.join(', ')}, so a renderer still has to invent ${missing.length} setting(s)`)
}

const disagreed = served.fields.filter(
  (f) => JSON.stringify(loaded.defaults[f]) !== JSON.stringify(served.defaults[f]),
)
if (disagreed.length) {
  await fail(`the engine and the database disagree about ${disagreed.join(', ')}`)
}

// The ones the plan names by value, so a silent change to any of them fails here.
const stated = { stack_at: 1, width: '1.0', height: '1.0', depth: '1.0', display: 'all_faces', shape: 'square', surface: 'plain' }
for (const [field, value] of Object.entries(stated)) {
  if (JSON.stringify(loaded.defaults[field]) !== JSON.stringify(value)) {
    await fail(`${field}: the served default is ${JSON.stringify(loaded.defaults[field])}, the plan states ${JSON.stringify(value)}`)
  }
}

// 4. The vocabulary comes from the column too.
if (!loaded.vocabularies?.shape?.includes('cone')) {
  await fail('shape has no cone, so a conifer still has to lie about its silhouette')
}
if (JSON.stringify(loaded.vocabularies?.display) !== JSON.stringify(['all_faces', 'single'])) {
  await fail(`display's vocabulary is ${JSON.stringify(loaded.vocabularies?.display)}`)
}

// 5. The words that are gone stay gone.
for (const banned of ['zoom', 'walkable', 'blocking', 'blocked', 'blocks_movement', 'is_solid', 'occupies']) {
  if (served.fields.includes(banned)) await fail(`${banned} is back in the schema`)
}

// Nothing about the page's own rendering is asserted here on purpose. What /templates shows depends
// on whether the database has a map in it, so a check on the editor's chrome passes on a developer
// machine and fails on a fresh one, and says nothing either way about the defaults this gate is for.
// That the editor comes up and its controls work is sliderLimits.

await browser.close()
console.log(`PASS  served defaults: ${served.fields.length} settings, every one defaulted by the database and agreed by the engine`)
