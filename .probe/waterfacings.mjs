// THE WATER BORDER AT ALL FOUR CAMERA FACINGS.
//
// *"we also must ensure they stay consistent when rotating camera"*. The rotate control lives in the editor
// chrome (play mode carries only Exit Game), so the four corners are shot there with the panels dismissed.
//
// The river is an ELEMENT BUTTON ("Water" tab, then a course), not a select. A probe that drove a "River"
// select silently built a map with no river at all and reported zero water cells.
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'
const OUT = process.env.OUT || '/home/visiond/.claude/jobs/beedf1c6/tmp/facings'
mkdirSync(OUT, { recursive: true })
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
await p.getByRole('button', { name: new RegExp('^' + (process.env.PRESET || 'Woodland')) }).first().click()
await p.waitForTimeout(600)
await p.getByRole('button', { name: /^Water$/ }).first().click()
await p.waitForTimeout(400)
await p.getByRole('button', { name: new RegExp('^' + (process.env.COURSE || 'Winds through')) }).first().click()
await p.waitForTimeout(400)
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3500)
// Dismiss the panels so the canvas is the whole frame.
for (const btn of await p.locator('button', { hasText: /^✕$/ }).all()) await btn.click().catch(() => {})
await p.locator('button', { hasText: /^«Tools$/ }).first().click().catch(() => {})
await p.waitForTimeout(600)

const water = await p.evaluate(() => {
  const rows = globalThis.__nebulithGrid.groundSlugs()
  const cells = []
  const kinds = {}
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
    if (!/water/.test(rows[r][c])) continue
    cells.push([c, r])
    kinds[rows[r][c]] = (kinds[rows[r][c]] || 0) + 1
  }
  return { n: cells.length, kinds, mid: cells[Math.floor(cells.length / 2)] }
})
console.log('water cells:', water.n)
console.log('pieces:', JSON.stringify(water.kinds))
if (!water.n) { console.log('NO WATER, nothing to look at'); await b.close(); process.exit(1) }

// PUT THE HERO IN THE RIVER'S MIDDLE so the camera frames the water rather than a corner of the map.
await p.evaluate(mid => globalThis.__setHero?.(mid[0], mid[1] + 1), water.mid)
await p.waitForTimeout(900)
const bx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
for (let i = 0; i < Number(process.env.ZOOM || 3); i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(140) }
await p.waitForTimeout(700)
const shot = async tag => {
  const png = await p.evaluate(() => [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0].toDataURL('image/png'))
  writeFileSync(`${OUT}/${tag}.png`, Buffer.from(png.split(',')[1], 'base64'))
  console.log('shot', tag, 'facing', await p.evaluate(() => globalThis.__cameraFacing?.()))
}
await shot('face0')
for (const f of [1, 2, 3]) {
  const rot = p.locator('button', { hasText: /Rotate/ }).first()
  if (!(await rot.count())) { console.log('ROTATE BUTTON GONE at facing', f); break }
  await rot.click()
  await p.waitForTimeout(900)
  await shot(`face${f}`)
}
await b.close()
