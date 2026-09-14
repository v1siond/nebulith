/**
 * STEP 1 — EXHAUSTIVE FEATURE INVENTORY of the editor.
 *
 *   "literally do a list of all features in the editor .../games/97829bd2-... a list of all features, all
 *    clickable things, every little single thing that can be interacted with, ALL FEATURES list them"
 *
 * Most controls only exist in a particular STATE (a panel open, something selected, a modal up), so the
 * editor is visited state by state and every interactive element is extracted in each. The output is one
 * JSON: every state, every control in it, and a deduplicated master list.
 *
 * Nothing is judged here — this run only establishes WHAT EXISTS. Step 2 uses each one.
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const S = process.argv[2]
const GAME = 'http://localhost:3000/personal-projects/game-engine/games/97829bd2-78fa-4d8f-94aa-8d0cea5f8ffb'

const states = []
let page

/** Everything a user can interact with, with enough detail to identify and later drive it. */
const extract = () => page.evaluate(() => {
  const SEL = 'button,a[href],input,select,textarea,summary,details,[role=button],[role=tab],[role=menuitem],[role=switch],[role=slider],[contenteditable=true],canvas'
  const seen = new Set()
  const out = []
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect()
    const visible = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'
    const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') ||
      (el.tagName === 'CANVAS' ? 'canvas' : (el.textContent || '').replace(/\s+/g, ' ').trim())).slice(0, 70)
    if (!label) continue
    const kind = el.tagName === 'INPUT' ? `input[${el.type}]` : el.tagName.toLowerCase()
    const key = `${kind}|${label}|${Math.round(r.x)},${Math.round(r.y)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      kind, label,
      role: el.getAttribute('role') || null,
      disabled: el.disabled ?? el.getAttribute('aria-disabled') === 'true',
      pressed: el.getAttribute('aria-pressed'),
      value: el.tagName === 'INPUT' || el.tagName === 'SELECT' ? String(el.value ?? '').slice(0, 30) : null,
      min: el.min || null, max: el.max || null,
      visible,
      offscreen: visible && (r.bottom > innerHeight || r.right > innerWidth || r.top < 0),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      region: (() => {
        // By ANCESTOR, not coordinate: a tile grid runs past the bottom of the window, so a y-based test
        // filed 283 palette tiles as "bottom-bar" in the first run.
        if (el.closest('[role=dialog]')) return 'modal'
        const asides = [...document.querySelectorAll('aside')]
        const left = asides.find(a => a.getBoundingClientRect().x < 120)
        const right = asides.find(a => a.getBoundingClientRect().right > innerWidth - 120)
        if (left && left.contains(el)) return r.x < 80 ? 'left-rail' : 'rail-panel'
        if (right && right.contains(el)) return 'right-sidebar'
        if (el.closest('nav,header')) return 'top-bar'
        if (r.y > innerHeight - 70 && r.x > 380 && r.x < innerWidth - 340) return 'bottom-bar'
        if (r.x < 380 && r.y > 70) return 'rail-panel'
        return 'floating'
      })(),
    })
  }
  return out
})

async function capture(name, note) {
  const controls = await extract()
  states.push({ state: name, note: note ?? '', count: controls.length, controls })
  await page.screenshot({ path: `${S}/inv/${name}.png` }).catch(() => {})
  const off = controls.filter(c => c.offscreen).length
  const dis = controls.filter(c => c.disabled).length
  console.log(`${String(controls.length).padStart(3)} controls  ${name.padEnd(28)} ${off ? `· ${off} OFF-SCREEN` : ''}${dis ? ` · ${dis} disabled` : ''}`)
  return controls
}

const btn = t => page.locator('button', { hasText: t }).first()
const has = async l => (await l.count()) > 0
const tryClick = async (loc, ms = 900) => { if (await has(loc)) { await loc.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(ms); return true } return false }

/** Close whatever overlay is up, and PROVE it closed.
 *  The first run captured states 30-52 as identical because an open dialog swallowed every later click —
 *  Esc does not close these modals, so the × has to be found inside the dialog itself. */
async function dismiss() {
  for (let i = 0; i < 4; i++) {
    const dlg = page.locator('[role=dialog]')
    if ((await dlg.count()) === 0) return true
    const x = dlg.locator('button', { hasText: /^×$|^✕$|^✖$|Close|Exit/ }).first()
    if (await has(x)) await x.click({ timeout: 4000 }).catch(() => {})
    else await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(700)
  }
  const stuck = (await page.locator('[role=dialog]').count()) > 0
  if (stuck) console.log('   ! a dialog would not close — reloading to continue')
  if (stuck) { await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(5000) }
  return !stuck
}
async function canvasClick(fx, fy, opts = {}) {
  const b = await page.locator('canvas').first().boundingBox()
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy, opts)
  await page.waitForTimeout(700)
}

async function main() {
  const browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 160)))

  await page.goto(GAME, { waitUntil: 'networkidle', timeout: 120000 })
  await page.waitForTimeout(6000)

  await capture('00-opened', 'the game as it loads, nothing selected')

  // The saved level is nearly empty (5 tiles, 0 units), so most selection states cannot exist yet. Build a
  // town through the REAL UI first — that is also the first flow a user runs, so its cost is recorded here.
  await tryClick(btn(/Generate/i), 1200)
  await tryClick(btn(/^Town$/), 1200)
  await tryClick(btn(/Generate world/), 9000)
  const seeded = await page.evaluate(() => ({
    assets: window.__gridKinds ? Object.keys(window.__gridKinds()).length : 0,
    units: typeof window.__entityScreens === 'function' ? window.__entityScreens().length : 0,
  }))
  console.log(`   populated the level through the UI: ${seeded.assets} tiles, ${seeded.units} units\n`)

  // ── every rail panel ────────────────────────────────────────────────────────────────
  for (const [label, name] of [['Select', '01-rail-select'], ['Terrain', '02-rail-terrain'],
    ['Objects', '03-rail-objects'], ['Characters', '04-rail-characters'],
    ['Generate', '05-rail-generate'], ['Rules', '06-rail-rules'], ['Art\\s*style', '07-rail-artstyle']]) {
    if (await tryClick(page.locator('button', { hasText: new RegExp(label, 'i') }).first())) {
      await capture(name, `left rail → ${label}`)
    }
  }

  // Rules has tabs
  await tryClick(btn(/Rules/i))
  for (const t of ['Triggers', 'Connections', 'Quests']) {
    if (await tryClick(btn(new RegExp(`^${t}`, 'i')))) await capture(`08-rules-${t.toLowerCase()}`, `Rules → ${t} tab`)
  }

  // ── content, so selections are possible ────────────────────────────────────────────
  const assets = await page.evaluate(() => window.__gridKinds ? Object.keys(window.__gridKinds()).length : 0)
  const ents = await page.evaluate(() => typeof window.__entityScreens === 'function' ? window.__entityScreens().length : 0)
  console.log(`\n   the saved game holds ${assets} placed tiles and ${ents} units\n`)

  // ── selection states ───────────────────────────────────────────────────────────────
  await tryClick(btn(/Select/i))
  await canvasClick(0.45, 0.55)
  await capture('10-cell-selected', 'clicked a map cell')

  // scroll the sidebar to reveal everything it holds
  await page.evaluate(() => {
    const a = [...document.querySelectorAll('div,aside')].find(d => d.scrollHeight > d.clientHeight + 20 && d.getBoundingClientRect().x > innerWidth - 400)
    if (a) a.scrollTop = a.scrollHeight
  })
  await page.waitForTimeout(700)
  await capture('11-cell-scrolled', 'same selection, sidebar scrolled to the bottom')

  await canvasClick(0.5, 0.5, { modifiers: ['Shift'] })
  await canvasClick(0.55, 0.55, { modifiers: ['Shift'] })
  await capture('12-multi-select', 'shift-clicked several cells')

  // a unit
  const entXY = await page.evaluate(() => {
    const e = typeof window.__entityScreens === 'function' ? window.__entityScreens() : []
    const hit = e.find(x => x.x != null && x.y != null)
    return hit ? { x: hit.x, y: hit.y, kind: hit.kind } : null
  })
  if (entXY) {
    await page.mouse.click(entXY.x, entXY.y); await page.waitForTimeout(1000)
    await capture('13-unit-selected', `clicked a ${entXY.kind}`)
    await page.evaluate(() => {
      const a = [...document.querySelectorAll('div,aside')].find(d => d.scrollHeight > d.clientHeight + 20 && d.getBoundingClientRect().x > innerWidth - 400)
      if (a) a.scrollTop = a.scrollHeight
    })
    await page.waitForTimeout(600)
    await capture('14-unit-scrolled', 'unit selected, sidebar scrolled')
  } else {
    console.log('   (no unit found on screen to select)')
  }

  // ── floating panels reachable from the inspector ───────────────────────────────────
  for (const [label, name] of [['Edit settings', '20-panel-settings'], ['Animate', '21-panel-animation'],
    ['Triggers', '22-panel-triggers'], ['Stats', '23-panel-stats'],
    ['Inventory & abilities', '24-panel-unit-inventory'], ['Quests…', '25-panel-unit-quests'],
    ['Attacks', '26-panel-attacks'], ['Replace tile', '27-panel-tile-library'],
    ['Connectors', '28-panel-connectors']]) {
    const b = page.locator('button', { hasText: new RegExp(label, 'i') }).first()
    if (await has(b)) {
      await b.scrollIntoViewIfNeeded().catch(() => {})
      if (await tryClick(b, 1400)) await capture(name, `opened via "${label}"`)
      await dismiss()
    }
  }

  // ── the always-on floating pair + menus ────────────────────────────────────────────
  for (const [label, name] of [['Inventory \\(I\\)', '30-player-inventory'], ['Quests \\(Q\\)', '31-quest-log'],
    ['More', '32-menu-more'], ['Overlays', '33-menu-overlays'], ['Help', '34-help'], ['Game 1|Game', '35-game-menu']]) {
    const b = page.locator('button', { hasText: new RegExp(label) }).first()
    if (await tryClick(b, 1300)) {
      await capture(name, `opened "${label}"`)
      await dismiss()
    }
  }

  // ── views ──────────────────────────────────────────────────────────────────────────
  for (const [label, name] of [['^2D$', '40-view-2d'], ['^Top$', '41-view-top'], ['^Flow$', '42-view-flow'], ['ISO', '43-view-iso']]) {
    if (await tryClick(page.locator('button', { hasText: new RegExp(label) }).first(), 1600)) {
      await capture(name, `view → ${label.replace(/[\^$]/g, '')}`)
    }
  }

  // ── play mode ──────────────────────────────────────────────────────────────────────
  if (await tryClick(btn(/Play/i), 3000)) {
    await capture('50-play', 'play mode')
    await tryClick(btn(/Inventory/i), 1400); await capture('51-play-inventory', 'play → inventory')
    await dismiss()
    await tryClick(btn(/Exit/i), 2500)
    await capture('52-back-to-editor', 'exited play')
  }

  // ── master list ────────────────────────────────────────────────────────────────────
  const master = new Map()
  for (const s of states) for (const c of s.controls) {
    const k = `${c.region}|${c.kind}|${c.label}`
    if (!master.has(k)) master.set(k, { ...c, seenIn: [s.state] })
    else master.get(k).seenIn.push(s.state)
  }
  const list = [...master.values()].sort((a, b) => a.region.localeCompare(b.region) || a.label.localeCompare(b.label))

  writeFileSync(`${S}/inventory.json`, JSON.stringify({ states, master: list, errors }, null, 1))

  console.log(`\n══ ${states.length} states · ${list.length} DISTINCT interactive controls`)
  const byRegion = {}
  for (const c of list) byRegion[c.region] = (byRegion[c.region] ?? 0) + 1
  console.log('   by region:', JSON.stringify(byRegion))
  console.log('   off-screen at least once:', list.filter(c => c.offscreen).length)
  console.log('   disabled at least once:', list.filter(c => c.disabled).length)
  console.log('   page errors:', errors.length ? errors.slice(0, 4) : 'none')
  await browser.close()
}
await main()
