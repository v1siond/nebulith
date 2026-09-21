/**
 * How many canvas operations one frame costs, counted PER CANVAS.
 *
 * The first version of this counted every 2D context together, which conflates three surfaces: the map, the
 * level minimap (its own repaint timer) and the Preview window (a full render of the subject at 20fps). A
 * total tells you nothing about which one to fix, and "is the preview expensive" is exactly the question.
 */
import { chromium } from 'playwright'
import { BASE } from './base.mjs'
const LABEL = process.argv[2] ?? 'Woodland city', CATEGORY = process.argv[3] ?? 'city'
const SECONDS = Number(process.argv[4] ?? 4)
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } })
await page.addInitScript(() => {
  const w = window
  w.__ops = {}
  w.__frames = 0
  const raf = w.requestAnimationFrame.bind(w)
  w.requestAnimationFrame = cb => raf(t => { w.__frames++; return cb(t) })
  // Name a canvas by its class, which is how this app tells its surfaces apart.
  const nameOf = c => (c && c.canvas && (c.canvas.className || c.canvas.id)) || '(offscreen)'
  for (const name of ['drawImage', 'fill', 'stroke', 'save']) {
    const orig = CanvasRenderingContext2D.prototype[name]
    CanvasRenderingContext2D.prototype[name] = function (...args) {
      const key = `${nameOf(this)}|${name}`
      w.__ops[key] = (w.__ops[key] ?? 0) + 1
      return orig.apply(this, args)
    }
  }
})
await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
if (CATEGORY !== 'wilderness') { await page.selectOption('select', CATEGORY).catch(() => {}); await page.waitForTimeout(500) }
await page.getByRole('button', { name: new RegExp('^' + LABEL) }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Build this world/ }).click()
await page.waitForTimeout(5000)
await page.evaluate(() => { window.__ops = {}; window.__frames = 0 })
await page.keyboard.down('w'); await page.keyboard.down('d')
await page.waitForTimeout(SECONDS * 1000)
await page.keyboard.up('w'); await page.keyboard.up('d')
const { ops, frames } = await page.evaluate(() => ({ ops: window.__ops, frames: window.__frames }))
console.log(`frames ${frames} over ${SECONDS}s\n`)
for (const [k, n] of Object.entries(ops).sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(8)}  ${(n / Math.max(1, frames)).toFixed(0).padStart(5)}/frame  ${k}`)
}
await b.close()
