// ─────────────────────────────────────────────────────────────
// NEBULITH — BUILD A CONNECTED MULTI-ROOM GAME (the real flow, not "click generate").
// For each room: generate → place entities → wire a connector to a previously SAVED
// template → save it to the DB. Then the Flow view shows every level connected.
//
// Run (dev server up on :3000, DB reachable):
//   SHOWCASE_FAST=1 SHOWCASE_RES=1440 npx playwright test nebulith-build   # rehearsal
//   SHOWCASE_RES=1440 npx playwright test nebulith-build                   # record
// ─────────────────────────────────────────────────────────────
import { test } from '../support/video-showcase.js'
import { moveClick, moveTo } from '../support/showcase.js'
import fs from 'node:fs'
import path from 'node:path'

test.use({ recordingName: 'nebulith-build' })
test.setTimeout(30 * 60 * 1000)

const B = Number(process.env.SHOWCASE_BEAT) || 1
const pause = (p, ms) => p.waitForTimeout(Math.round(ms * B))
const see = (p) => pause(p, 1400)
const beat = (p) => pause(p, 650)

// Canvas centre (the showcase viewport is 1920x1080; canvas.width = innerWidth).
const W = 960
const H = 540

test('nebulith — build a connected multi-room game', async ({ page }) => {
  const T0 = Date.now()
  const timeline = []
  const mark = (name) => timeline.push({ name, t: (Date.now() - T0) / 1000 })
  const btn = (name) => page.getByRole('button', { name, exact: true })

  // Top view places relative to the player at screen centre, tileSize 16 → cell
  // (playerCol+dC, playerRow+dR) sits at (W + dC*16 + 8, H + dR*16 + 8).
  const clickCell = async (dC, dR) => {
    const x = W + dC * 16 + 8
    const y = H + dR * 16 + 8
    await moveTo(page, x, y, 12)
    await page.mouse.click(x, y)
    await beat(page)
  }
  const generate = async (zone, variant) => {
    await moveClick(page, btn(zone))
    await moveClick(page, btn(variant))
    await see(page)
  }
  const saveAs = async (name) => {
    const input = page.getByLabel('Template name')
    await input.click()
    await input.fill(name)
    await moveClick(page, btn('Save')) // form is closed here → only the template Save
    await pause(page, 1300) // DB round-trip
  }
  const freshEditor = async () => {
    await page.goto('/templates?new=1')
    await page.locator('canvas').first().waitFor({ state: 'visible' })
    await moveClick(page, btn('Top')) // top view: the easy surface for placement
    await beat(page)
  }

  async function buildRoom({ zone, variant, name, target, populate }) {
    await generate(zone, variant)

    if (populate) {
      mark('entities')
      await moveClick(page, page.getByRole('button', { name: /Enemy/ }))
      await clickCell(1, 0) // adjacent to the player → we fight this one in play
      await clickCell(3, 0)
      await clickCell(-2, 1)
      await moveClick(page, page.getByRole('button', { name: /NPC/ }))
      await clickCell(0, -2)
      await moveClick(page, page.getByRole('button', { name: /Scatter entities/ }))
      await see(page)

      // author a KILL quest on the NPC (select it → its quest card appears)
      mark('quest')
      await moveClick(page, page.getByRole('button', { name: /NPC/ })) // disarm the NPC tool
      await clickCell(0, -2) // click the NPC → selects it
      await page.getByLabel('Quest title').fill('Cull the goblins')
      await page.getByLabel('Objective kind').selectOption('kill')
      await page.getByLabel('Objective target').fill('goblin')
      await page.getByLabel('Objective count').fill('3')
      await page.getByLabel('Quest-giver NPC').selectOption({ index: 1 })
      await moveClick(page, page.getByRole('button', { name: 'Link quest to giver' }))
      await see(page)

      // PLAY it — fight the adjacent enemy with real combat + attack animations
      mark('fight')
      await moveClick(page, btn('ISO'))
      await beat(page)
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('f') // regular attack
        await pause(page, 300)
      }
      await page.keyboard.press('g') // a special attack
      await see(page)
      await moveClick(page, btn('Top')) // back to top for placement on the next rooms
    }

    if (target) {
      mark('connect')
      await moveClick(page, btn('Edit')) // connector mode ON
      await clickCell(-1, -1) // pick a cell → opens the connector form
      await page.getByLabel('Target template', { exact: true }).selectOption({ label: target })
      await moveClick(page, btn('Save').first()) // connector-form Save (first in DOM)
      await moveClick(page, btn('Exit')) // connector mode OFF
      await see(page)
    }

    await saveAs(name)
  }

  // ── welcome ──
  await freshEditor()
  // Clear templates left by earlier runs so the connector dropdown is unambiguous and
  // the final graph shows ONLY this game's rooms (not duplicates).
  await page.evaluate(async () => {
    const res = await fetch('/api/templates?limit=500')
    const data = await res.json()
    for (const t of data.templates ?? []) {
      try {
        await fetch(`/api/templates/${t.id}`, { method: 'DELETE' })
      } catch {
        /* best-effort */
      }
    }
  })
  await see(page)
  mark('welcome')
  await see(page)

  // ── room 1: Forest (populated) — saved first so later rooms can target it ──
  mark('forest')
  await buildRoom({ zone: 'spring', variant: 'forest', name: 'Forest', populate: true })

  // ── room 2: Temple → connects back to Forest ──
  mark('temple')
  await freshEditor()
  await buildRoom({ zone: 'autumn', variant: 'temple', name: 'Temple', target: 'Forest' })

  // ── room 3: Cave → connects to Temple ──
  mark('cave')
  await freshEditor()
  await buildRoom({ zone: 'lava', variant: 'cave', name: 'Cave', target: 'Temple' })

  // ── room 4: Boss → connects to Cave ──
  mark('boss')
  await freshEditor()
  await buildRoom({ zone: 'lava', variant: 'boss stage', name: 'Boss', target: 'Cave' })

  // ── the payoff: Flow view shows every level wired together ──
  mark('flow')
  await moveClick(page, btn('Flow'))
  await see(page)
  await see(page)

  mark('end')
  fs.mkdirSync(path.resolve(process.cwd(), 'recordings'), { recursive: true })
  fs.writeFileSync(
    path.resolve(process.cwd(), 'recordings/nebulith-build-timeline.json'),
    JSON.stringify(timeline, null, 2),
  )
})
