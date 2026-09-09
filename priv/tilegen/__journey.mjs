/**
 * BUILD A GAME — an end-to-end usability journey, played as a real user would.
 *
 * Alexander, 2026-09-08:
 *   "it's running all flows end to end, from creating a new game, generating maps, connectors, again.
 *    You must use the app as a real user would, you must literally create a game with it, document the
 *    pain points, the bottlenecks, the inconveniences, the bad things in the UI, in the UX, and based of
 *    that, propose solutions."
 *
 * THE GOAL, as a player would state it:
 *   "A town where a shopkeeper asks me to clear a cave. A door in the town takes me to the cave. The cave
 *    has monsters. Killing them finishes the quest."
 *
 * Every step records: what I was trying to do, what I clicked, what happened, how many clicks it cost, and
 * how long it took. Friction is the output — a step that needs 6 clicks and a guess is a finding even when
 * it "works".
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const S = process.argv[2]
const URL = 'http://localhost:3000/personal-projects/game-engine/templates'

const log = []
const errors = []
let page, clicks = 0, phase = 'setup'

const shot = n => page.screenshot({ path: `${S}/ux/j-${n}.png` }).catch(() => {})

/** Every click goes through here so the cost of a task is measured, not estimated. */
async function click(locator, what) {
  clicks++
  await locator.click({ timeout: 8000 })
  await page.waitForTimeout(450)
  return what
}
const btn = t => page.locator('button', { hasText: t }).first()
const has = async l => (await l.count()) > 0

async function step(id, goal, fn) {
  const c0 = clicks, t0 = Date.now()
  let outcome = 'OK', detail = '', notes = []
  try {
    const r = (await fn({ note: m => notes.push(m) })) || {}
    outcome = r.outcome ?? 'OK'
    detail = r.detail ?? ''
  } catch (e) {
    outcome = 'FAILED'
    detail = e.message.split('\n')[0].slice(0, 200)
  }
  const entry = { id, phase, goal, outcome, detail, clicks: clicks - c0, seconds: +((Date.now() - t0) / 1000).toFixed(1), notes }
  log.push(entry)
  console.log(`${outcome.padEnd(7)} ${id.padEnd(5)} [${entry.clicks}c ${entry.seconds}s] ${goal}`)
  if (detail) console.log(`               ${detail}`)
  notes.forEach(n => console.log(`             · ${n}`))
}

const state = () => page.evaluate(() => {
  const w = window
  return {
    assets: w.__gridKinds ? Object.keys(w.__gridKinds()).length : null,
    entities: typeof w.__entityScreens === 'function' ? w.__entityScreens().length : null,
    saveState: (document.body.textContent.match(/Not saved yet|Saved/) || [])[0] ?? null,
    banner: (document.body.textContent.match(/(Placing[^·]{0,30}|Select ·)/) || [])[0] ?? null,
  }
})
const panelsOpen = () => page.evaluate(() => [...document.querySelectorAll('*')]
  .filter(e => /^▾\s?(Generate a world|Characters|Paint|Tile compositions|Rules|Tileset art style)/i.test((e.textContent || '').trim()) && e.children.length < 3)
  .map(e => (e.textContent || '').trim().slice(0, 22)))
async function canvasClick(fx, fy, opts = {}) {
  const b = await page.locator('canvas').first().boundingBox()
  clicks++
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy, opts)
  await page.waitForTimeout(600)
}

async function main() {
  const browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200)))
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 })
  await page.waitForTimeout(2500)

  // ══ PHASE 1 · start a new game ═════════════════════════════════════════════════════
  phase = '1-new-game'
  await shot('01-landing')

  await step('1.1', 'Work out how to start a new game from the landing page', async ({ note }) => {
    const opts = await page.evaluate(() => [...document.querySelectorAll('button,a')].map(e => e.textContent.trim()).filter(Boolean))
    note(`choices offered: ${JSON.stringify(opts.slice(0, 12))}`)
    const newGame = btn(/New Game/i)
    if (!(await has(newGame))) return { outcome: 'MISSING', detail: 'no "New Game" control' }
    return { detail: 'a "+ New Game" button exists alongside an existing game card' }
  })

  await step('1.2', 'Create the new game and land somewhere I can build', async ({ note }) => {
    await click(btn(/New Game/i), 'New Game')
    await page.waitForTimeout(5000)
    const onCanvas = (await page.locator('canvas').count()) > 0
    const url = page.url()
    note(`url after create: ${url}`)
    if (!onCanvas) {
      // maybe it created a card and stayed on the list — a real user would then hunt for Open
      const open = btn(/^Open$/)
      if (await has(open)) {
        note('it stayed on the games list; I had to find and click "Open" myself')
        await click(open, 'Open')
        await page.waitForTimeout(4500)
      }
    }
    const ready = (await page.locator('canvas').count()) > 0
    return { outcome: ready ? 'OK' : 'FAILED', detail: ready ? 'editor open' : 'never reached an editor' }
  })
  await shot('02-editor')

  await step('1.3', 'Understand what to do first, from the screen alone', async ({ note }) => {
    const guidance = await page.evaluate(() => {
      const t = document.body.textContent.replace(/\s+/g, ' ')
      return (t.match(/Nothing selected[^.]*\.[^.]*\./) || t.match(/Click anything[^.]*\./) || [])[0] ?? null
    })
    note(`on-screen guidance: ${guidance ?? 'none'}`)
    const emptyMap = (await state()).assets
    return { detail: `map starts with ${emptyMap} assets; the only instruction is in the right sidebar, pointing at the left rail` }
  })

  // ══ PHASE 2 · the town ═════════════════════════════════════════════════════════════
  phase = '2-town'
  await step('2.1', 'Find where maps are generated', async () => {
    const g = btn(/Generate/)
    if (!(await has(g))) return { outcome: 'MISSING', detail: 'no Generate entry' }
    await click(g, 'Generate rail')
    const p = await panelsOpen()
    return { outcome: p.length === 1 ? 'OK' : 'BROKEN', detail: `panels showing: ${JSON.stringify(p)}` }
  })
  await shot('03-generate')

  await step('2.2', 'Make it a town (pick season + type + generate)', async ({ note }) => {
    const before = await state()
    if (await has(btn(/^Spring$/))) await click(btn(/^Spring$/), 'Spring')
    if (await has(btn(/^Town$/))) await click(btn(/^Town$/), 'Town')
    else note('no Town chip found')
    const g = btn(/Generate world/)
    if (!(await has(g))) return { outcome: 'MISSING', detail: 'no "Generate world" button visible without scrolling' }
    await click(g, 'Generate world')
    await page.waitForTimeout(7000)
    const after = await state()
    note(`3 clicks to get a map: season → type → generate`)
    return { outcome: (after.assets ?? 0) > (before.assets ?? 0) ? 'OK' : 'BROKEN', detail: `assets ${before.assets}→${after.assets}, entities ${before.entities}→${after.entities}` }
  })
  await shot('04-town')

  // ══ PHASE 3 · edit the map by hand ═════════════════════════════════════════════════
  phase = '3-edit-map'
  await step('3.1', 'Paint a patch of water into the town', async ({ note }) => {
    await click(btn(/Terrain/), 'Terrain rail')
    const p = await panelsOpen()
    if (p.length !== 1) note(`WRONG PANEL: ${JSON.stringify(p)}`)
    const search = page.locator('input[type=search]').first()
    if (!(await has(search))) return { outcome: 'MISSING', detail: 'no tile search' }
    clicks++
    await search.fill('water'); await page.waitForTimeout(900)
    const results = await page.evaluate(() => [...document.querySelectorAll('button[title]')].map(b => b.getAttribute('title')).slice(0, 6))
    note(`search "water" → ${JSON.stringify(results)}`)
    const tile = page.locator('button[title]').first()
    if (!(await has(tile))) return { outcome: 'BROKEN', detail: 'search returned no tiles' }
    await click(tile, 'water tile')
    const before = await state()
    await canvasClick(0.55, 0.6)
    const after = await state()
    return { outcome: after.assets !== before.assets ? 'OK' : 'SILENT', detail: `assets ${before.assets}→${after.assets}` }
  })
  await shot('05-painted')

  await step('3.2', 'Drop a house next to it', async ({ note }) => {
    await click(btn(/Objects/), 'Objects rail')
    const p = await panelsOpen()
    if (p.length !== 1) note(`WRONG PANEL: ${JSON.stringify(p)}`)
    const item = page.locator('button[title]').first()
    if (!(await has(item))) return { outcome: 'MISSING', detail: 'no compositions listed' }
    const name = await item.getAttribute('title')
    await click(item, name)
    const before = await state()
    await canvasClick(0.4, 0.42)
    const after = await state()
    return { outcome: (after.assets ?? 0) > (before.assets ?? 0) ? 'OK' : 'SILENT', detail: `stamped "${name}"; assets ${before.assets}→${after.assets}` }
  })

  await step('3.3', 'Undo that with Ctrl+Z', async () => {
    const before = await state()
    clicks++
    await page.keyboard.press('Control+z'); await page.waitForTimeout(1500)
    const after = await state()
    return { outcome: before.assets !== after.assets ? 'OK' : 'SILENT', detail: `assets ${before.assets}→${after.assets}` }
  })

  // ══ PHASE 4 · people ═══════════════════════════════════════════════════════════════
  phase = '4-characters'
  await step('4.1', 'Add a shopkeeper NPC to the town', async ({ note }) => {
    await click(btn(/Characters/), 'Characters rail')
    const p = await panelsOpen()
    if (p.length !== 1) note(`WRONG PANEL: ${JSON.stringify(p)}`)
    const banner = (await state()).banner
    note(`mode banner reads: "${banner}"`)
    const search = page.locator('input[type=search]').first()
    if (await has(search)) { clicks++; await search.fill('man'); await page.waitForTimeout(800) }
    const who = page.locator('button[title]').first()
    if (!(await has(who))) return { outcome: 'MISSING', detail: 'no creatures listed' }
    const name = await who.getAttribute('title')
    await click(who, name)
    const before = await state()
    await canvasClick(0.48, 0.52)
    const after = await state()
    return { outcome: (after.entities ?? 0) > (before.entities ?? 0) ? 'OK' : 'SILENT', detail: `picked "${name}"; entities ${before.entities}→${after.entities}` }
  })
  await shot('06-npc')

  await step('4.2', 'Add enemies for the quest to be about', async ({ note }) => {
    const asEnemy = btn(/^Enemy$/)
    if (await has(asEnemy)) await click(asEnemy, 'Place as: Enemy')
    else note('no "Place as: Enemy" control found')
    note(`banner now: "${(await state()).banner}"`)
    const search = page.locator('input[type=search]').first()
    if (await has(search)) { clicks++; await search.fill('goblin'); await page.waitForTimeout(800) }
    const g = page.locator('button[title]').first()
    if (!(await has(g))) return { outcome: 'MISSING', detail: 'no goblin found' }
    await click(g, 'goblin')
    const before = await state()
    await canvasClick(0.6, 0.45)
    await canvasClick(0.63, 0.48)
    const after = await state()
    return { outcome: (after.entities ?? 0) > (before.entities ?? 0) ? 'OK' : 'SILENT', detail: `entities ${before.entities}→${after.entities}` }
  })

  await step('4.3', 'Select the shopkeeper and rename them', async ({ note }) => {
    clicks++
    await page.keyboard.press('Escape'); await page.waitForTimeout(500) // stop placing first
    await canvasClick(0.48, 0.52)
    const insp = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' ').match(/Unit — [^(]*\([^)]*\)/)?.[0] ?? null)
    note(`inspector title: ${insp ?? 'no unit card — the click did not select the unit'}`)
    if (!insp) return { outcome: 'BROKEN', detail: 'clicking the placed unit did not select it' }
    const nameInput = page.locator('input[aria-label*="ame" i], input[placeholder*="ame" i]').first()
    if (!(await has(nameInput))) return { outcome: 'MISSING', detail: 'unit card has no name field visible' }
    clicks++
    await nameInput.fill('Shopkeeper'); await page.waitForTimeout(600)
    return { detail: 'renamed' }
  })
  await shot('07-unit-selected')

  // ══ PHASE 5 · make an animation ════════════════════════════════════════════════════
  phase = '5-animation'
  await step('5.1', 'Find the way to animate the selected character', async ({ note }) => {
    const a = btn(/Animate/)
    if (!(await has(a))) {
      const all = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean))
      note(`no Animate button visible. Buttons on screen: ${JSON.stringify(all.slice(-18))}`)
      return { outcome: 'MISSING', detail: 'Animate is not visible without scrolling the sidebar' }
    }
    const box = await a.boundingBox()
    note(`Animate button at y=${Math.round(box?.y ?? -1)} (viewport is 1000 tall)`)
    await click(a, 'Animate…')
    await page.waitForTimeout(1200)
    return { detail: 'animation panel opened' }
  })
  await shot('08-animation-open')

  await step('5.2', 'Actually create an animation', async ({ note }) => {
    const opts = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent.replace(/\s+/g, ' ').trim()).filter(t => /animation|move|frame/i.test(t)))
    note(`animation choices: ${JSON.stringify(opts)}`)
    const add = btn(/Add settings animation|Add sprite animation|Random move/)
    if (!(await has(add))) return { outcome: 'MISSING', detail: 'no way to add an animation' }
    await click(add, 'add animation')
    await page.waitForTimeout(1200)
    const rows = await page.evaluate(() => document.body.textContent.match(/(opacity|zoom|rotate|frame)/gi)?.length ?? 0)
    return { detail: `after adding, ${rows} animation-related labels on screen` }
  })
  await shot('09-animation-added')

  await step('5.3', 'Confirm the animation persisted (close and reopen)', async ({ note }) => {
    const close = page.locator('button', { hasText: /^×$|^✕$/ }).first()
    if (await has(close)) await click(close, 'close animation panel')
    else { clicks++; await page.keyboard.press('Escape'); note('no × found; tried Esc') }
    await page.waitForTimeout(900)
    const a = btn(/Animate/)
    if (!(await has(a))) return { outcome: 'BROKEN', detail: 'cannot reopen — Animate button gone' }
    const label = await a.textContent()
    note(`the button now reads "${label.trim()}" (a count here would confirm it saved)`)
    return { detail: `reopened via "${label.trim()}"` }
  })

  // ══ PHASE 6 · a second level and a door between them ═══════════════════════════════
  phase = '6-connectors'
  await step('6.1', 'Find how to make a SECOND level for the cave', async ({ note }) => {
    const ways = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent.replace(/\s+/g, ' ').trim())
      .filter(t => /level|template|new|\+/i.test(t)).slice(0, 14))
    note(`candidate controls: ${JSON.stringify(ways)}`)
    return { detail: 'recorded what a user would have to guess between' }
  })

  await step('6.2', 'Open the Rules workspace to find connections', async ({ note }) => {
    await click(btn(/Rules/), 'Rules rail')
    const p = await panelsOpen()
    if (p.length !== 1 || !/Rules/i.test(p[0] || '')) return { outcome: 'BROKEN', detail: `expected only Rules, got ${JSON.stringify(p)}` }
    const tabs = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => /^(Triggers|Connections|Quests)/i.test(t)))
    note(`tabs: ${JSON.stringify(tabs)}`)
    return { detail: 'Rules panel opened alone' }
  })
  await shot('10-rules')

  await step('6.3', 'Create a connection to another level', async ({ note }) => {
    const conn = btn(/^Connections/i)
    if (await has(conn)) await click(conn, 'Connections tab')
    const add = btn(/New connection|＋|Add connection/i)
    if (!(await has(add))) {
      const txt = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' ').match(/(select|pick|choose|first)[^.]{0,90}\./i)?.[0] ?? null)
      note(`blocked-reason text on screen: ${txt ?? 'none'}`)
      return { outcome: 'BLOCKED', detail: 'no add-connection control; prerequisite not stated as an action' }
    }
    await click(add, 'new connection')
    await page.waitForTimeout(1200)
    return { detail: 'connection authoring opened' }
  })
  await shot('11-connector')

  await step('6.4', 'Author a quest on the shopkeeper', async ({ note }) => {
    const q = btn(/^Quests/i)
    if (await has(q)) await click(q, 'Quests tab')
    const add = btn(/New quest|Add quest/i)
    if (!(await has(add))) {
      const why = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' ').match(/(needs?|requires?|add an? NPC)[^.]{0,90}\./i)?.[0] ?? null)
      note(`reason shown: ${why ?? 'none'}`)
      return { outcome: 'BLOCKED', detail: 'no add-quest control reachable' }
    }
    await click(add, 'new quest')
    await page.waitForTimeout(1200)
    return { detail: 'quest authoring opened' }
  })
  await shot('12-quest')

  // ══ PHASE 7 · save and play ════════════════════════════════════════════════════════
  phase = '7-save-play'
  await step('7.1', 'Save the game', async ({ note }) => {
    const before = (await state()).saveState
    const s = btn(/Save/)
    if (!(await has(s))) return { outcome: 'MISSING', detail: 'no Save' }
    if (await s.isDisabled().catch(() => false)) return { outcome: 'BLOCKED', detail: `Save disabled while state reads "${before}"` }
    await click(s, 'Save')
    await page.waitForTimeout(3000)
    const after = (await state()).saveState
    note(`save state ${before} → ${after}`)
    return { outcome: after === 'Saved' ? 'OK' : 'SILENT', detail: `${before} → ${after}` }
  })

  await step('7.2', 'Play the game and move the hero', async ({ note }) => {
    const p = btn(/Play/)
    if (!(await has(p))) return { outcome: 'MISSING', detail: 'no Play' }
    await click(p, 'Play')
    await page.waitForTimeout(3000)
    const before = await page.evaluate(() => window.__nebulith ?? null)
    for (const k of ['KeyW', 'KeyW', 'KeyD', 'KeyD']) { await page.keyboard.press(k); await page.waitForTimeout(220) }
    await page.waitForTimeout(800)
    const after = await page.evaluate(() => window.__nebulith ?? null)
    note(`player telemetry before ${JSON.stringify(before)} after ${JSON.stringify(after)}`)
    const moved = JSON.stringify(before) !== JSON.stringify(after)
    return { outcome: moved ? 'OK' : 'SILENT', detail: moved ? 'hero moved' : 'no observable movement' }
  })
  await shot('13-play')

  await step('7.3', 'Attack and use an ability in play', async ({ note }) => {
    await page.keyboard.press('KeyF'); await page.waitForTimeout(700)
    await page.keyboard.press('Digit1'); await page.waitForTimeout(700)
    const hud = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' ').match(/attack[^·]{0,40}/i)?.[0] ?? null)
    note(`HUD hint: ${hud}`)
    return { detail: 'pressed F then 1' }
  })

  await step('7.4', 'Open the inventory in play, then close it', async ({ note }) => {
    const i = btn(/Inventory/)
    if (!(await has(i))) return { outcome: 'MISSING', detail: 'no inventory button in play' }
    await click(i, 'Inventory')
    await page.waitForTimeout(1200)
    const items = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => /Iron|Health|Hunter|Round|Flint/.test(t)))
    note(`item labels as shown: ${JSON.stringify(items)}`)
    clicks++
    await page.keyboard.press('Escape'); await page.waitForTimeout(900)
    const stillOpen = await page.evaluate(() => !!document.querySelector('[role=dialog][aria-label=Inventory]'))
    note(stillOpen ? 'Esc did NOT close it' : 'Esc closed it')
    if (stillOpen) {
      const x = page.locator('button', { hasText: /×/ }).first()
      if (await has(x)) await click(x, 'close ×')
    }
    return { outcome: stillOpen ? 'BROKEN' : 'OK', detail: stillOpen ? 'Esc does not close the inventory' : 'closed with Esc' }
  })
  await shot('14-inventory')

  await step('7.5', 'Get back to editing', async ({ note }) => {
    const exit = btn(/Exit/)
    if (!(await has(exit))) return { outcome: 'MISSING', detail: 'no Exit control found' }
    await click(exit, 'Exit')
    await page.waitForTimeout(2500)
    const back = await has(btn(/Play/))
    note(`back in editor: ${back}`)
    return { outcome: back ? 'OK' : 'BROKEN', detail: back ? 'editor chrome returned' : 'stuck' }
  })
  await shot('15-back')

  writeFileSync(`${S}/journey.json`, JSON.stringify({ log, errors, totalClicks: clicks }, null, 1))
  const bad = log.filter(l => l.outcome !== 'OK')
  console.log(`\n══ ${log.length} steps · ${clicks} clicks total · ${bad.length} steps with problems`)
  console.log('page errors:', errors.length ? errors.slice(0, 6) : 'none')
  await browser.close()
}
await main()
