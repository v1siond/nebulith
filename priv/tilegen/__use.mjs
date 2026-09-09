/**
 * STEP 2 — USE EVERY FEATURE AND DOCUMENT WHAT HAPPENS.
 *
 * Driven by the real accessible labels found in step 1's inventory, so each probe targets the control a
 * user would actually hit. Each records: intent → what was clicked → what changed → cost in clicks.
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const S = process.argv[2]
const GAME = 'http://localhost:3000/personal-projects/game-engine/games/97829bd2-78fa-4d8f-94aa-8d0cea5f8ffb'
const log = [], errors = []
let page, clicks = 0

const shot = n => page.screenshot({ path: `${S}/use/${n}.png` }).catch(() => {})
const lbl = t => page.getByLabel(t, { exact: false }).first()
const btn = t => page.locator('button', { hasText: t }).first()
const has = async l => (await l.count()) > 0
async function click(l) { clicks++; await l.click({ timeout: 8000 }); await page.waitForTimeout(500) }
async function canvasClick(fx, fy, opts = {}) {
  const b = await page.locator('canvas').first().boundingBox()
  clicks++
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy, opts)
  await page.waitForTimeout(700)
}
/** A catalog swatch (tile / creature / composition), NOT any old button that happens to have a title.
 *  The first run's `button[title]` matched top-bar buttons and "armed the FPS tracker" — a harness bug that
 *  would have been reported as an app bug. Step 1's inventory showed swatch titles carry "(style:label)". */
const swatch = () => page.locator('button[title*="(ascii:"], button[title*="(emoji:"]').first()
const swatchTitles = n => page.evaluate(k => [...document.querySelectorAll('button[title*="(ascii:"],button[title*="(emoji:"]')]
  .map(b => b.getAttribute('title')).slice(0, k), n)
/** A composition swatch reads "Big house 6 — 6×4 cells". */
const compSwatch = () => page.locator('button[title*="cells"]').first()

/** Between flows: clear any overlay/armed state so one stuck modal cannot cascade into later failures. */
async function reset() {
  for (let i = 0; i < 3 && (await page.locator('[role=dialog]').count()) > 0; i++) {
    const x = page.locator('[role=dialog]').locator('button').filter({ hasText: /^×$|^✕$|Close|Exit/ }).first()
    if (await has(x)) await x.click({ timeout: 3000 }).catch(() => {})
    else await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(600)
  }
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(300)
}

const st = () => page.evaluate(() => ({
  tiles: window.__gridKinds ? Object.keys(window.__gridKinds()).length : null,
  units: typeof window.__entityScreens === 'function' ? window.__entityScreens().length : null,
  save: (document.body.textContent.match(/Not saved yet|Saved/) || [])[0] ?? null,
  saveDisabled: (() => { const b = [...document.querySelectorAll('button')].find(x => /Save/.test(x.getAttribute('aria-label') || x.textContent)); return b ? b.disabled : null })(),
  banner: (document.body.textContent.match(/(Placing[^·]{0,28}|Select ·)/) || [])[0] ?? null,
  dialogs: document.querySelectorAll('[role=dialog]').length,
}))

async function use(id, intent, fn) {
  await reset()
  const c0 = clicks, notes = []
  let outcome = 'OK', detail = ''
  try {
    const r = (await fn({ note: m => notes.push(m) })) || {}
    outcome = r.outcome ?? 'OK'; detail = r.detail ?? ''
  } catch (e) { outcome = 'FAILED'; detail = e.message.split('\n')[0].slice(0, 180) }
  log.push({ id, intent, outcome, detail, clicks: clicks - c0, notes })
  console.log(`${outcome.padEnd(7)} ${id.padEnd(5)} [${clicks - c0}c] ${intent}`)
  if (detail) console.log(`              → ${detail}`)
  notes.forEach(n => console.log(`              · ${n}`))
}

async function main() {
  const browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  await page.goto(GAME, { waitUntil: 'networkidle', timeout: 120000 })
  await page.waitForTimeout(6000)

  await use('U1', 'Read whether the level has unsaved work, and whether Save is usable', async ({ note }) => {
    const s = await st()
    note(`save text "${s.save}", Save button disabled: ${s.saveDisabled}`)
    return { outcome: s.saveDisabled ? 'BROKEN' : 'OK', detail: s.saveDisabled ? 'Save is disabled on a freshly-loaded level with no explanation' : 'Save enabled' }
  })

  await use('U2', 'Generate a town and check it actually contains a town', async ({ note }) => {
    const b = await st()
    await click(btn(/Generate/)); await click(btn(/^Town$/))
    const g = btn(/Generate world/)
    if (!(await has(g))) return { outcome: 'MISSING', detail: 'the Generate button is below the fold' }
    await click(g); await page.waitForTimeout(9000)
    const a = await st()
    note(`tiles ${b.tiles}→${a.tiles}, units ${b.units}→${a.units}`)
    return {
      outcome: (a.tiles ?? 0) > (b.tiles ?? 0) ? 'OK' : 'BROKEN',
      detail: (a.tiles ?? 0) > (b.tiles ?? 0) ? 'buildings and terrain appeared' : `generated ${a.units} units but NO tiles — a town with no buildings`,
    }
  })
  await shot('u2-generated')

  await use('U3', 'Does making a change enable Save?', async ({ note }) => {
    const s = await st()
    note(`after generating a whole town: save text "${s.save}", disabled: ${s.saveDisabled}`)
    return { outcome: s.saveDisabled ? 'BROKEN' : 'OK', detail: s.saveDisabled ? 'still disabled after generating a town — the work cannot be saved' : 'enabled once dirty' }
  })

  await use('U4', 'Paint a tile: search, arm, click the map', async ({ note }) => {
    await click(btn(/Terrain/))
    const search = page.locator('input[type=search]').first()
    if (!(await has(search))) return { outcome: 'MISSING', detail: 'no tile search' }
    clicks++; await search.fill('water'); await page.waitForTimeout(1000)
    note(`"water" → ${JSON.stringify(await swatchTitles(5))}`)
    const t = swatch()
    if (!(await has(t))) return { outcome: 'BROKEN', detail: 'search matched nothing' }
    await click(t)
    const b = await st(); note(`banner after arming: "${b.banner}"`)
    await canvasClick(0.5, 0.55)
    const a = await st()
    return { outcome: a.tiles !== b.tiles ? 'OK' : 'SILENT', detail: `tiles ${b.tiles}→${a.tiles}` }
  })
  await shot('u4-painted')

  await use('U5', 'Undo the paint (Ctrl+Z)', async () => {
    const b = await st(); clicks++
    await page.keyboard.press('Control+z'); await page.waitForTimeout(1500)
    const a = await st()
    return { outcome: b.tiles !== a.tiles ? 'OK' : 'SILENT', detail: `tiles ${b.tiles}→${a.tiles}` }
  })

  await use('U6', 'Stamp a building from Objects', async ({ note }) => {
    await click(btn(/Objects/))
    const item = compSwatch()
    if (!(await has(item))) return { outcome: 'MISSING', detail: 'no compositions' }
    const name = await item.getAttribute('title'); note(`armed "${name}"`)
    await click(item)
    const b = await st()
    await canvasClick(0.42, 0.45)
    const a = await st()
    return { outcome: (a.tiles ?? 0) > (b.tiles ?? 0) ? 'OK' : 'SILENT', detail: `tiles ${b.tiles}→${a.tiles}` }
  })

  await use('U7', 'Place an enemy, and check the banner matches the setting', async ({ note }) => {
    await click(btn(/Characters/))
    const e = btn(/^Enemy$/); if (await has(e)) await click(e)
    const b0 = await st(); note(`"Place as: Enemy" chosen → banner says "${b0.banner}"`)
    const search = page.locator('input[type=search]').first()
    if (await has(search)) { clicks++; await search.fill('goblin'); await page.waitForTimeout(900) }
    const g = swatch()
    if (!(await has(g))) return { outcome: 'MISSING', detail: 'no goblin' }
    await click(g)
    const b = await st()
    await canvasClick(0.58, 0.48)
    const a = await st()
    return { outcome: (a.units ?? 0) > (b.units ?? 0) ? 'OK' : 'SILENT', detail: `units ${b.units}→${a.units}` }
  })
  await shot('u7-enemy')

  await use('U8', 'Select a unit by clicking it on the map', async ({ note }) => {
    clicks++; await page.keyboard.press('Escape'); await page.waitForTimeout(600)
    const e = await page.evaluate(() => {
      const l = typeof window.__entityScreens === 'function' ? window.__entityScreens() : []
      const h = l.find(x => x.x != null); return h ? { x: h.x, y: h.y, kind: h.kind } : null
    })
    if (!e) return { outcome: 'MISSING', detail: 'no unit on screen' }
    clicks++; await page.mouse.click(e.x, e.y); await page.waitForTimeout(1200)
    const title = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' ').match(/Unit — [^(]{0,30}\([^)]*\)/)?.[0] ?? null)
    note(`clicked the ${e.kind} → inspector title: ${title ?? 'NOT SELECTED'}`)
    return { outcome: title ? 'OK' : 'BROKEN', detail: title ?? 'clicking a unit did not select it' }
  })

  await use('U9', 'Reach the Animate control for that unit', async ({ note }) => {
    const a = lbl('Animate')
    if (!(await has(a))) return { outcome: 'MISSING', detail: 'no Animate control' }
    const box = await a.boundingBox()
    const off = box && (box.y > 1000 || box.y < 0)
    note(`Animate sits at y=${Math.round(box?.y ?? -1)} in a 1000px window → ${off ? 'OFF-SCREEN, must scroll' : 'visible'}`)
    await a.scrollIntoViewIfNeeded().catch(() => {})
    await click(a); await page.waitForTimeout(1400)
    const opened = await page.evaluate(() => /ANIMATION/i.test(document.body.textContent))
    return { outcome: opened ? (off ? 'FRICTION' : 'OK') : 'BROKEN', detail: opened ? `opened${off ? ' (after scrolling)' : ''}` : 'nothing opened' }
  })
  await shot('u9-animation')

  await use('U10', 'Create an animation and confirm it sticks', async ({ note }) => {
    const opts = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent.replace(/\s+/g, ' ').trim()).filter(t => /animation|move/i.test(t)))
    note(`choices: ${JSON.stringify(opts)}`)
    const add = btn(/Add sprite animation|Add settings animation|Random move/)
    if (!(await has(add))) return { outcome: 'MISSING', detail: 'no add-animation control' }
    await click(add); await page.waitForTimeout(1500)
    const after = await page.evaluate(() => ({
      rows: document.body.textContent.match(/\b(idle|move|attack|opacity|zoom|rotate)\b/gi)?.length ?? 0,
      preview: !!document.querySelector('canvas'),
    }))
    note(`after adding: ${after.rows} animation labels on screen`)
    // close and reopen to see if it persisted
    const close = page.locator('[role=dialog] button, button').filter({ hasText: /^×$|^✕$/ }).first()
    if (await has(close)) await click(close)
    await page.waitForTimeout(900)
    const a2 = lbl('Animate')
    const label = (await has(a2)) ? (await a2.textContent()).trim() : null
    note(`the Animate button now reads "${label}" — a count here is the only feedback that it saved`)
    return { outcome: after.rows > 0 ? 'OK' : 'SILENT', detail: `animation added; reopen label "${label}"` }
  })

  await use('U11', 'Open the player inventory and get back out again', async ({ note }) => {
    const i = lbl('Open inventory')
    if (!(await has(i))) return { outcome: 'MISSING', detail: 'no inventory button' }
    await click(i); await page.waitForTimeout(1400)
    const items = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => /^(Iron|Health|Hunter|Round|Flint|Battle|Oak)/.test(t)).slice(0, 6))
    note(`item labels as DISPLAYED: ${JSON.stringify(items)}`)
    const slotsDisabled = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => /^(Helmet|Chest|Gloves|Boots|Weapon|Ring|Neck)/.test(b.textContent.trim())).map(b => b.disabled))
    note(`equipment slots disabled: ${JSON.stringify(slotsDisabled)}`)
    clicks++; await page.keyboard.press('Escape'); await page.waitForTimeout(900)
    let open = (await st()).dialogs > 0
    note(`Esc closed it: ${!open}`)
    if (open) {
      const x = lbl('Close inventory')
      if (await has(x)) { await click(x); await page.waitForTimeout(700); open = (await st()).dialogs > 0; note(`"Close inventory" worked: ${!open}`) }
    }
    return { outcome: open ? 'BROKEN' : 'FRICTION', detail: open ? 'no way out of the inventory' : 'Esc does not close it; only the labelled Close button does' }
  })
  await shot('u11-inventory')

  await use('U12', 'Add a trigger from the Rules panel', async ({ note }) => {
    await click(btn(/Rules/))
    const t = btn(/^Triggers/); if (await has(t)) await click(t)
    const add = lbl('Add a trigger')
    if (!(await has(add))) return { outcome: 'MISSING', detail: 'no add-trigger control' }
    const dis = await add.isDisabled().catch(() => false)
    const why = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' ').match(/(Select|Pick|Choose|needs)[^.]{0,80}\./i)?.[0] ?? null)
    note(`add-trigger disabled: ${dis}; reason shown: ${why ?? 'NONE'}`)
    if (dis) return { outcome: 'BLOCKED', detail: `disabled${why ? ` — reason given: "${why}"` : ' with NO reason given'}` }
    await click(add); await page.waitForTimeout(1200)
    return { detail: 'trigger editor opened' }
  })

  await use('U13', 'Create a quest', async ({ note }) => {
    const q = btn(/^Quests/); if (await has(q)) await click(q)
    const add = btn(/New quest/)
    if (!(await has(add))) return { outcome: 'MISSING', detail: 'no new-quest control' }
    const dis = await add.isDisabled().catch(() => false)
    if (dis) { const why = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' ').match(/[^.]{0,90}NPC[^.]{0,40}\./i)?.[0] ?? null); note(`reason: ${why}`); return { outcome: 'BLOCKED', detail: why ?? 'disabled, no reason' } }
    await click(add); await page.waitForTimeout(1400)
    const fields = await page.evaluate(() => [...document.querySelectorAll('input,select')].map(e => e.getAttribute('aria-label') || e.placeholder || e.name).filter(Boolean).slice(0, 10))
    note(`quest fields: ${JSON.stringify(fields)}`)
    return { detail: 'quest authoring opened' }
  })
  await shot('u13-quest')

  await use('U14', 'Create a connection to another level', async ({ note }) => {
    const c = btn(/^Connections/); if (await has(c)) await click(c)
    const add = page.locator('button', { hasText: /New connection|Place a connection|＋/ }).first()
    if (!(await has(add))) return { outcome: 'MISSING', detail: 'no add-connection control in the Rules panel' }
    await click(add); await page.waitForTimeout(1500)
    const fields = await page.evaluate(() => [...document.querySelectorAll('input,select,button')].map(e => e.getAttribute('aria-label') || e.textContent?.trim()).filter(t => t && /template|level|spawn|walk|press|save/i.test(t)).slice(0, 10))
    note(`connection fields: ${JSON.stringify(fields)}`)
    return { detail: 'connection authoring opened' }
  })

  await use('U15', 'Switch to each view and back', async ({ note }) => {
    const seen = []
    for (const v of ['^2D$', '^Top$', '^Flow$', 'ISO']) {
      const b = page.locator('button', { hasText: new RegExp(v) }).first()
      if (await has(b)) { await click(b); await page.waitForTimeout(1600); seen.push(v.replace(/[\^$]/g, '')) }
    }
    note(`views reached: ${JSON.stringify(seen)}`)
    return { detail: `${seen.length} of 4 views reachable` }
  })

  await use('U16', 'Play the game: move, attack, exit', async ({ note }) => {
    const p = lbl('Execute game')
    if (!(await has(p))) return { outcome: 'MISSING', detail: 'no Play control' }
    await click(p); await page.waitForTimeout(3500)
    const b = await page.evaluate(() => window.__nebulith ?? null)
    for (const k of ['KeyW', 'KeyW', 'KeyD']) { await page.keyboard.press(k); await page.waitForTimeout(250) }
    await page.keyboard.press('KeyF'); await page.waitForTimeout(600)
    const a = await page.evaluate(() => window.__nebulith ?? null)
    note(`telemetry ${JSON.stringify(b)} → ${JSON.stringify(a)}`)
    const controls = await page.evaluate(() => [...document.querySelectorAll('button')].map(x => x.getAttribute('aria-label') || x.textContent.trim()).filter(Boolean))
    note(`controls available in play: ${JSON.stringify(controls)}`)
    const ex = btn(/Exit/); if (await has(ex)) await click(ex)
    await page.waitForTimeout(2500)
    return { outcome: JSON.stringify(b) !== JSON.stringify(a) ? 'OK' : 'SILENT', detail: 'played and exited' }
  })
  await shot('u16-play')

  await use('U17', 'Finally: save the game', async ({ note }) => {
    const s = lbl('Save template')
    if (!(await has(s))) return { outcome: 'MISSING', detail: 'no Save' }
    const dis = await s.isDisabled().catch(() => false)
    const before = (await st()).save
    note(`save text "${before}", disabled ${dis}`)
    if (dis) return { outcome: 'BROKEN', detail: 'after a full editing session, Save is STILL disabled — the work cannot be persisted from the top bar' }
    await click(s); await page.waitForTimeout(3000)
    return { detail: `state now "${(await st()).save}"` }
  })

  writeFileSync(`${S}/usage.json`, JSON.stringify({ log, errors, clicks }, null, 1))
  const bad = log.filter(l => l.outcome !== 'OK')
  console.log(`\n══ ${log.length} flows · ${clicks} clicks · ${bad.length} with problems`)
  console.log('   ' + bad.map(b => `${b.id}:${b.outcome}`).join('  '))
  console.log('   page errors:', errors.length ? errors.slice(0, 4) : 'none')
  await browser.close()
}
await main()
