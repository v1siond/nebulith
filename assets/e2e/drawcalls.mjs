/** How many canvas operations one frame costs, counted in the page. */
import { chromium } from 'playwright'
const LABEL = process.argv[2] ?? 'Woodland city'
const CATEGORY = process.argv[3] ?? 'city'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } })
await page.addInitScript(() => {
  const w = window
  w.__ops = { drawImage: 0, fill: 0, stroke: 0, save: 0, frames: 0 }
  const raf = w.requestAnimationFrame.bind(w)
  w.requestAnimationFrame = cb => raf(t => { w.__ops.frames++; return cb(t) })
  const P = CanvasRenderingContext2D.prototype
  for (const name of ['drawImage', 'fill', 'stroke', 'save']) {
    const orig = P[name]
    P[name] = function (...args) { w.__ops[name]++; return orig.apply(this, args) }
  }
})
await page.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
if (CATEGORY !== 'wilderness') { await page.selectOption('select', CATEGORY).catch(() => {}); await page.waitForTimeout(500) }
await page.getByRole('button', { name: new RegExp('^' + LABEL) }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Build this world/ }).click()
await page.waitForTimeout(5000)
await page.evaluate(() => { const o = window.__ops; for (const k in o) o[k] = 0 })
await page.keyboard.down('w'); await page.keyboard.down('d')
await page.waitForTimeout(4000)
await page.keyboard.up('w'); await page.keyboard.up('d')
const o = await page.evaluate(() => window.__ops)
console.log(`frames ${o.frames}`)
for (const k of ['drawImage', 'fill', 'stroke', 'save']) {
  console.log(`  ${k.padEnd(10)} ${String(o[k]).padStart(8)} total   ${(o[k] / Math.max(1, o.frames)).toFixed(0).padStart(6)} per frame`)
}
await b.close()
