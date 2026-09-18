// ─────────────────────────────────────────────────────────────
// NEBULITH TUTORIAL — the docs-compliant demo (demo-video-playbook.md).
// Hero scenario: build a connected dungeon from an empty grid, populate + quest +
// fight one room, chain three more, open the map. Beats + lines: NEBULITH-DEMO-SCRIPT.md.
// SYNC: holdAct(mark) holds each beat ≥ its narration line (recordings/narration-durations.json),
// so every line finishes on its own screen (no bleed). Run AFTER the voiceover seeds durations.
// ─────────────────────────────────────────────────────────────
import { test } from '../support/video-showcase.js'
import { moveClick, moveTo } from '../support/showcase.js'
import fs from 'node:fs'
import path from 'node:path'

test.use({ recordingName: 'nebulith-tutorial' })
test.setTimeout(30 * 60 * 1000)

const W = 960
const H = 540
let DUR = {}
try {
  DUR = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'recordings/narration-durations.json'), 'utf8'))
} catch {
  /* first/seed pass: no durations yet → holdAct falls back to a default */
}

test('nebulith tutorial — build a connected game', async ({ page }) => {
  const T0 = Date.now()
  const timeline = []
  const mark = (name) => timeline.push({ name, t: (Date.now() - T0) / 1000 })
  // Hold the current screen ≥ this line's spoken length (+ lead) so it finishes here.
  const holdAct = (name) => page.waitForTimeout(Math.max((DUR[name] ?? 2.2) * 1000 + 500, 900))
  const btn = (name) => page.getByRole('button', { name, exact: true })
  const clickCell = async (dC, dR) => {
    const x = W + dC * 16 + 8
    const y = H + dR * 16 + 8
    await moveTo(page, x, y, 12)
    await page.mouse.click(x, y)
    await page.waitForTimeout(250)
  }
  const generate = async (zone, variant) => {
    await moveClick(page, btn(zone))
    await moveClick(page, btn(variant))
    await page.waitForTimeout(600)
  }
  const saveAs = async (name) => {
    const input = page.getByLabel('Template name')
    await input.click()
    await input.fill(name)
    await moveClick(page, btn('Save'))
    await page.waitForTimeout(1300)
  }
  const fresh = async () => {
    await page.goto('/templates?new=1')
    await page.locator('canvas').first().waitFor({ state: 'visible' })
    await moveClick(page, btn('Top'))
    await page.waitForTimeout(400)
  }
  async function connectRoom(zone, variant, name, target) {
    await fresh()
    await generate(zone, variant)
    await moveClick(page, btn('Edit')) // connector mode
    await clickCell(-1, -1)
    await page.getByLabel('Target template', { exact: true }).selectOption({ label: target })
    await moveClick(page, btn('Save').first()) // connector-form Save
    await moveClick(page, btn('Exit'))
    await saveAs(name)
  }

  // ── welcome (the intro-card narration plays over this) ──
  await fresh()
  await page.evaluate(async () => {
    const r = await fetch('/api/templates?limit=500')
    const d = await r.json()
    for (const t of d.templates ?? []) {
      try {
        await fetch(`/api/templates/${t.id}`, { method: 'DELETE' })
      } catch {
        /* best-effort */
      }
    }
  })
  mark('welcome')
  await holdAct('welcome')

  // ── generate a spring forest ──
  mark('generate')
  await generate('spring', 'forest')
  await holdAct('generate')

  // ── populate: enemies (one adjacent for the fight) + a quest-giver + a patrol pack ──
  mark('populate')
  await moveClick(page, page.getByRole('button', { name: /Enemy/ }))
  await clickCell(1, 0)
  await clickCell(3, 0)
  await clickCell(-2, 1)
  await moveClick(page, page.getByRole('button', { name: /NPC/ }))
  await clickCell(0, -2)
  await moveClick(page, page.getByRole('button', { name: /Scatter entities/ }))
  await holdAct('populate')

  // ── quest: author a kill quest on the NPC ──
  mark('quest')
  await moveClick(page, page.getByRole('button', { name: /NPC/ })) // disarm
  await clickCell(0, -2) // select the NPC → its quest card appears
  await page.getByLabel('Quest title').fill('Cull the goblins')
  await page.getByLabel('Objective kind').selectOption('kill')
  await page.getByLabel('Objective target').fill('goblin')
  await page.getByLabel('Objective count').fill('3')
  await page.getByLabel('Quest-giver NPC').selectOption({ index: 1 })
  await moveClick(page, page.getByRole('button', { name: 'Link quest to giver' }))
  await holdAct('quest')

  // ── play: fight the adjacent goblin (real combat + attack animations) ──
  // Switch to ISO and let it render BEFORE the mark, so the play line plays over the
  // actual fight (not the top-view→iso transition).
  await moveClick(page, btn('ISO'))
  await page.waitForTimeout(900)
  mark('play')
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('f')
    await page.waitForTimeout(300)
  }
  await page.keyboard.press('g')
  await holdAct('play')

  // ── save the room ──
  mark('save')
  await moveClick(page, btn('Top'))
  await page.waitForTimeout(300)
  await saveAs('Forest')
  await holdAct('save')

  // ── connect: temple → Forest ──
  mark('connect')
  await connectRoom('autumn', 'temple', 'Temple', 'Forest')
  await holdAct('connect')

  // ── expand: cave → Temple, boss → Cave ──
  mark('expand')
  await connectRoom('lava', 'cave', 'Cave', 'Temple')
  await connectRoom('lava', 'boss stage', 'Boss', 'Cave')
  await holdAct('expand')

  // ── map: the connected graph (payoff) ──
  // Open Flow and let the graph render BEFORE the mark, so the map line plays over the
  // connected graph (not the lingering boss-save screen).
  await moveClick(page, btn('Flow'))
  await page.waitForTimeout(1900) // Flow graph render + fade settles before the line
  mark('map')
  await holdAct('map')

  // ── closing (the CTA-card narration plays over the appended outro card) ──
  mark('closing')
  await holdAct('closing')

  fs.mkdirSync(path.resolve(process.cwd(), 'recordings'), { recursive: true })
  fs.writeFileSync(
    path.resolve(process.cwd(), 'recordings/nebulith-tutorial-timeline.json'),
    JSON.stringify(timeline, null, 2),
  )
})
