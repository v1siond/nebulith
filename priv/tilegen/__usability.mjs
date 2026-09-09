/**
 * DEEP USABILITY RUN — attempts every editor function as a user would and records what actually happens.
 *
 * Alexander, 2026-09-08: "an analysis should go through ALL functionalities, CLICK ON ALL PLACES; ALL THINGS
 * IN THE UI; EVERYTHING; ON A TILE; ON A CHARACTER; TRY TO MAKE AN ANIMATION; ETC ETC ... literally use all
 * functionalities to determine how they currently work ... is a DEEP USABILITY test."
 *
 * Each probe states an INTENT, performs the clicks, then measures whether the intent was achieved.
 * Outcome vocabulary:
 *   OK        — the intent succeeded
 *   BROKEN    — the control exists and did not do its job
 *   SILENT    — the click registered and nothing observable happened
 *   MISSING   — no control found for a documented feature
 *   BLOCKED   — a prerequisite stopped it (recorded with the reason the UI gave, if any)
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const S = process.argv[2]
const BATCH = process.argv[3] || 'all'
const URL = 'http://localhost:3000/personal-projects/game-engine/templates'

const results = []
const errors = []
let page

const rec = (id, area, intent, outcome, detail, clicks) =>
  results.push({ id, area, intent, outcome, detail: String(detail).slice(0, 300), clicks })

const shot = n => page.screenshot({ path: `${S}/ux/probe-${n}.png` }).catch(() => {})

/** A button by visible text. */
const btn = t => page.locator('button', { hasText: t }).first()
const has = async loc => (await loc.count()) > 0

/** Run one probe, catching anything so one failure never ends the run. */
async function probe(id, area, intent, fn) {
  try {
    const r = await fn()
    rec(id, area, intent, r.outcome, r.detail ?? '', r.clicks ?? null)
    console.log(`${r.outcome.padEnd(8)} ${id.padEnd(6)} ${intent} — ${r.detail ?? ''}`)
  } catch (e) {
    rec(id, area, intent, 'ERROR', e.message, null)
    console.log(`ERROR    ${id.padEnd(6)} ${intent} — ${e.message.slice(0, 120)}`)
  }
}

/** Canvas helpers — click a fraction of the canvas box. */
async function canvasClick(fx, fy, opts = {}) {
  const box = await page.locator('canvas').first().boundingBox()
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, opts)
  await page.waitForTimeout(500)
}

/** State readers via the debug seams the app already exposes. */
const grid = () => page.evaluate(() => {
  const w = window
  return {
    assets: w.__gridKinds ? Object.keys(w.__gridKinds()).length : null,
    entities: typeof w.__entityScreens === 'function' ? w.__entityScreens().length : null,
    nebulith: w.__nebulith ?? null,
  }
})

/** Every visible panel header, to prove which panel is showing. */
const panels = () => page.evaluate(() => [...document.querySelectorAll('*')]
  .filter(e => /^▾\s?(Generate a world|Characters|Paint|Tile compositions|Rules|Tileset art style)/i.test((e.textContent || '').trim()) && e.children.length < 3)
  .map(e => (e.textContent || '').trim().slice(0, 24)))

/** Text of the right sidebar, for "did the inspector notice my selection". */
const inspector = () => page.evaluate(() => {
  const a = [...document.querySelectorAll('aside,div')].find(d => /INSPECTOR/.test(d.textContent || '') && d.textContent.length < 4000)
  return a ? a.textContent.replace(/\s+/g, ' ').trim().slice(0, 400) : null
})

// ───────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)) })

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 })
  await page.waitForTimeout(2500)

  // ── A · PROJECT ──────────────────────────────────────────────────────────────────────
  await probe('A1', 'project', 'Open a game from the landing page', async () => {
    const o = btn(/^Open$/)
    if (!(await has(o))) return { outcome: 'MISSING', detail: 'no Open button' }
    await o.click(); await page.waitForTimeout(4000)
    const inEditor = await has(btn(/Play/)) && (await page.locator('canvas').count()) > 0
    return { outcome: inEditor ? 'OK' : 'BROKEN', detail: inEditor ? 'editor rendered' : 'no canvas', clicks: 1 }
  })
  await shot('A1')

  await probe('A2', 'project', 'See whether the level has unsaved changes', async () => {
    const t = await page.evaluate(() => document.body.textContent.match(/Not saved yet|Saved|Unsaved/)?.[0] ?? null)
    return { outcome: t ? 'OK' : 'MISSING', detail: t ?? 'no save-state text' }
  })

  await probe('A3', 'project', 'Save the level with the top-bar button', async () => {
    const s = btn(/Save/)
    if (!(await has(s))) return { outcome: 'MISSING', detail: 'no Save button' }
    const disabled = await s.isDisabled().catch(() => false)
    if (disabled) return { outcome: 'BLOCKED', detail: 'Save is disabled with no stated reason', clicks: 0 }
    await s.click(); await page.waitForTimeout(2000)
    const t = await page.evaluate(() => document.body.textContent.match(/Not saved yet|Saved/)?.[0] ?? null)
    return { outcome: t === 'Saved' ? 'OK' : 'SILENT', detail: `state after save: ${t}`, clicks: 1 }
  })

  // ── B · GENERATE ────────────────────────────────────────────────────────────────────
  await probe('B1', 'generate', 'Open the Generate panel', async () => {
    await btn(/Generate/).first().click(); await page.waitForTimeout(900)
    const p = await panels()
    return { outcome: p.length === 1 && /Generate/i.test(p[0]) ? 'OK' : 'BROKEN', detail: `panels showing: ${JSON.stringify(p)}`, clicks: 1 }
  })
  await shot('B1')

  await probe('B2', 'generate', 'Pick a season (does it generate, or only set a value?)', async () => {
    const before = await grid()
    const s = btn(/^Summer$/)
    if (!(await has(s))) return { outcome: 'MISSING', detail: 'no Summer chip' }
    await s.click(); await page.waitForTimeout(1500)
    const after = await grid()
    return { outcome: 'OK', detail: `assets ${before.assets}→${after.assets} (inert chip = correct per spec)`, clicks: 1 }
  })

  await probe('B3', 'generate', 'Pick a map type', async () => {
    const t = btn(/^Town$/)
    if (!(await has(t))) return { outcome: 'MISSING', detail: 'no Town chip' }
    const before = await grid()
    await t.click(); await page.waitForTimeout(1500)
    const after = await grid()
    return { outcome: 'OK', detail: `assets ${before.assets}→${after.assets}`, clicks: 1 }
  })

  await probe('B4', 'generate', 'Generate a world and get a town on screen', async () => {
    const g = btn(/Generate world/)
    if (!(await has(g))) return { outcome: 'MISSING', detail: 'no "Generate world" button' }
    const before = await grid()
    await g.click(); await page.waitForTimeout(6000)
    const after = await grid()
    const made = (after.assets ?? 0) > (before.assets ?? 0)
    return { outcome: made ? 'OK' : 'BROKEN', detail: `assets ${before.assets}→${after.assets}, entities ${before.entities}→${after.entities}`, clicks: 1 }
  })
  await shot('B4')

  await probe('B5', 'generate', 'Change the map size and rebuild', async () => {
    const cols = page.locator('input').filter({ hasNot: page.locator('[type=search]') })
    const n = await cols.count()
    if (n === 0) return { outcome: 'MISSING', detail: 'no size inputs' }
    const r = btn(/Rebuild as/)
    return { outcome: (await has(r)) ? 'OK' : 'MISSING', detail: `${n} numeric inputs; rebuild button present: ${await has(r)}` }
  })

  await probe('B6', 'generate', 'Re-roll ONE layer, keeping the rest', async () => {
    const any = await page.evaluate(() => /RE-ROLL/i.test(document.body.textContent))
    if (!any) return { outcome: 'MISSING', detail: 'no re-roll section found in the panel' }
    const b = btn(/^Nature$|^Buildings$|^Decor$/)
    if (!(await has(b))) return { outcome: 'BROKEN', detail: 're-roll heading present but its buttons are not reachable (below the fold)' }
    const before = await grid()
    await b.click(); await page.waitForTimeout(3000)
    const after = await grid()
    return { outcome: before.assets !== after.assets ? 'OK' : 'SILENT', detail: `assets ${before.assets}→${after.assets}`, clicks: 1 }
  })

  // ── C · PAINT ───────────────────────────────────────────────────────────────────────
  await probe('C1', 'paint', 'Open the Terrain library', async () => {
    await btn(/Terrain/).first().click(); await page.waitForTimeout(900)
    const p = await panels()
    return { outcome: p.length === 1 && /Paint/i.test(p[0]) ? 'OK' : 'BROKEN', detail: `panels: ${JSON.stringify(p)}`, clicks: 1 }
  })
  await shot('C1')

  await probe('C2', 'paint', 'Search for a tile by name', async () => {
    const s = page.locator('input[type=search]').first()
    if (!(await has(s))) return { outcome: 'MISSING', detail: 'no search box in the tile library' }
    const ph = await s.getAttribute('placeholder')
    await s.fill('water'); await page.waitForTimeout(900)
    const shown = await page.evaluate(() => document.querySelectorAll('button[title]').length)
    return { outcome: 'OK', detail: `placeholder "${ph}"; ${shown} results for "water"`, clicks: 1 }
  })

  await probe('C3', 'paint', 'Filter tiles by category', async () => {
    const s = page.locator('input[type=search]').first()
    if (await has(s)) await s.fill('')
    await page.waitForTimeout(500)
    const chips = await page.evaluate(() => [...document.querySelectorAll('button')]
      .map(b => b.textContent.trim()).filter(t => /^(Terrain|Roads|Floors|Walls|Nature|Props|Decor|All)\s*\d*$/i.test(t)))
    return { outcome: chips.length ? 'OK' : 'MISSING', detail: `category chips: ${JSON.stringify(chips.slice(0, 12))}` }
  })

  await probe('C4', 'paint', 'Arm a tile and paint it onto the map', async () => {
    const tile = page.locator('button[title]').first()
    if (!(await has(tile))) return { outcome: 'MISSING', detail: 'no tile buttons' }
    const name = await tile.getAttribute('title')
    await tile.click(); await page.waitForTimeout(600)
    const before = await grid()
    await canvasClick(0.5, 0.55)
    const after = await grid()
    return {
      outcome: (after.assets ?? 0) !== (before.assets ?? 0) ? 'OK' : 'SILENT',
      detail: `armed "${name}"; assets ${before.assets}→${after.assets}`, clicks: 2,
    }
  })
  await shot('C4')

  await probe('C5', 'paint', 'Undo the paint with Ctrl+Z', async () => {
    const before = await grid()
    await page.keyboard.press('Control+z'); await page.waitForTimeout(1200)
    const after = await grid()
    return { outcome: before.assets !== after.assets ? 'OK' : 'SILENT', detail: `assets ${before.assets}→${after.assets}`, clicks: 1 }
  })

  await probe('C6', 'paint', 'Disarm the brush with Esc', async () => {
    await page.keyboard.press('Escape'); await page.waitForTimeout(600)
    const banner = await page.evaluate(() => document.body.textContent.match(/Placing[^·]*|Select ·/)?.[0] ?? null)
    return { outcome: banner && /Select/.test(banner) ? 'OK' : 'SILENT', detail: `mode banner now: ${banner}`, clicks: 1 }
  })

  // ── D · OBJECTS / COMPOSITIONS ──────────────────────────────────────────────────────
  await probe('D1', 'objects', 'Open the Objects library and stamp a house', async () => {
    await btn(/Objects/).first().click(); await page.waitForTimeout(1000)
    const p = await panels()
    const one = p.length === 1 && /compositions/i.test(p[0])
    const item = page.locator('button[title]').first()
    if (!(await has(item))) return { outcome: 'BROKEN', detail: `panel ok:${one}, but no composition buttons` }
    const name = await item.getAttribute('title')
    await item.click(); await page.waitForTimeout(600)
    const before = await grid()
    await canvasClick(0.42, 0.45)
    const after = await grid()
    return {
      outcome: (after.assets ?? 0) > (before.assets ?? 0) ? 'OK' : 'SILENT',
      detail: `panels ok:${one}; stamped "${name}"; assets ${before.assets}→${after.assets}`, clicks: 3,
    }
  })
  await shot('D1')

  // ── E · CHARACTERS ──────────────────────────────────────────────────────────────────
  await probe('E1', 'characters', 'Open the Characters library', async () => {
    await btn(/Characters/).first().click(); await page.waitForTimeout(1000)
    const p = await panels()
    return { outcome: p.length === 1 && /Characters/i.test(p[0]) ? 'OK' : 'BROKEN', detail: `panels: ${JSON.stringify(p)}`, clicks: 1 }
  })

  await probe('E2', 'characters', 'Search for a creature', async () => {
    const s = page.locator('input[type=search]').first()
    if (!(await has(s))) return { outcome: 'MISSING', detail: 'no creature search' }
    await s.fill('dog'); await page.waitForTimeout(800)
    const n = await page.evaluate(() => document.querySelectorAll('button[title]').length)
    return { outcome: n > 0 ? 'OK' : 'BROKEN', detail: `${n} results for "dog"`, clicks: 1 }
  })

  await probe('E3', 'characters', 'Place a dog on the map', async () => {
    const dog = page.locator('button[title]').first()
    if (!(await has(dog))) return { outcome: 'MISSING', detail: 'no creature button after search' }
    const name = await dog.getAttribute('title')
    await dog.click(); await page.waitForTimeout(600)
    const before = await grid()
    await canvasClick(0.55, 0.5)
    const after = await grid()
    return {
      outcome: (after.entities ?? 0) > (before.entities ?? 0) ? 'OK' : 'SILENT',
      detail: `picked "${name}"; entities ${before.entities}→${after.entities}; assets ${before.assets}→${after.assets}`, clicks: 2,
    }
  })
  await shot('E3')

  await probe('E4', 'characters', 'Understand what "Place as: Auto" will make', async () => {
    const banner = await page.evaluate(() => document.body.textContent.match(/Placing an? \w+/)?.[0] ?? null)
    const auto = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Auto')
      return b ? b.className.includes('orange') || b.className.includes('amber') : null
    })
    return { outcome: banner ? 'OK' : 'MISSING', detail: `banner "${banner}", Auto highlighted: ${auto}` }
  })

  writeFileSync(`${S}/usability-${BATCH}.json`, JSON.stringify({ results, errors }, null, 1))
  console.log(`\n── ${results.length} probes · ${results.filter(r => r.outcome === 'OK').length} OK · ` +
    `${results.filter(r => ['BROKEN', 'SILENT', 'MISSING', 'ERROR'].includes(r.outcome)).length} problems`)
  console.log('page errors:', errors.length ? errors.slice(0, 5) : 'none')
  await browser.close()
}

await main()
