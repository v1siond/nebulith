// ─────────────────────────────────────────────────────────────
// NEBULITH SHOWCASE — records the "0 → game-ready" demo against the live editor.
// Beats: welcome → generate forests (randomize) → temple → cave → boss → play →
// 2D. Output: recordings/demo-nebulith.mp4 (+ recordings/nebulith-timeline.json
// for the voice-over sync, per demo-video-playbook.md).
//
// Run (dev server must be up on :3000):
//   SHOWCASE_FAST=1 npx playwright test   # quick dress-rehearsal
//   npx playwright test                   # 4K record
// ─────────────────────────────────────────────────────────────
import { test } from '../support/video-showcase.js'
import { moveClick, moveHover } from '../support/showcase.js'
import fs from 'node:fs'
import path from 'node:path'

test.use({ recordingName: 'nebulith' })
test.setTimeout(30 * 60 * 1000)

const B = Number(process.env.SHOWCASE_BEAT) || 1
const pause = (p, ms) => p.waitForTimeout(Math.round(ms * B))
const see = (p) => pause(p, 1600)
const beat = (p) => pause(p, 850)

test('nebulith showcase', async ({ page }) => {
  const T0 = Date.now()
  const timeline = []
  const mark = (name) => timeline.push({ name, t: (Date.now() - T0) / 1000 })

  const btn = (name) => page.getByRole('button', { name, exact: true })
  const generate = async (zone, variant) => {
    await moveClick(page, btn(zone))
    await moveClick(page, btn(variant))
    await see(page)
  }

  // ── welcome ──
  await page.goto('/templates?new=1')
  await page.locator('canvas').first().waitFor({ state: 'visible' })
  await see(page)
  mark('welcome')
  await see(page)

  // Iso view (the 3D look)
  await moveClick(page, btn('ISO'))
  await beat(page)

  // ── spring forest (generate + re-roll) ──
  mark('forest')
  await generate('spring', 'forest')
  await moveClick(page, btn('forest')) // re-roll → a different layout
  await see(page)

  // ── summer forest (denser, deeper green — the seasons differ) ──
  mark('summer')
  await generate('summer', 'forest')

  // ── autumn temple ──
  mark('temple')
  await generate('autumn', 'temple')

  // ── lava cave + boss room ──
  mark('cave')
  await generate('lava', 'cave')
  mark('boss')
  await moveClick(page, btn('boss stage'))
  await see(page)

  // ── populate: scatter enemies + an NPC into the free space ──
  mark('populate')
  await moveClick(page, page.getByRole('button', { name: 'Scatter entities' }))
  await see(page)

  // ── inventory (I): equip grid + bag + special slots ──
  mark('inventory')
  await page.keyboard.press('i')
  await see(page)
  await page.keyboard.press('i') // close

  // ── play: walk + jump ──
  mark('play')
  for (const key of ['w', 'w', 'd', 'd', 's', 'a']) {
    await page.keyboard.down(key)
    await pause(page, 300)
    await page.keyboard.up(key)
  }
  await page.keyboard.press(' ') // jump
  await beat(page)

  // ── 2D view ──
  mark('twoD')
  await moveClick(page, btn('2D'))
  await see(page)

  mark('end')
  fs.mkdirSync(path.resolve(process.cwd(), 'recordings'), { recursive: true })
  fs.writeFileSync(
    path.resolve(process.cwd(), 'recordings/nebulith-timeline.json'),
    JSON.stringify(timeline, null, 2),
  )
})
