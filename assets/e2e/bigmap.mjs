/**
 * THE WORST CASE: a big map, zoomed all the way out so every cell of it is on screen, walked with WASD.
 *
 *     bin/e2e bigmap "Woodland city" city 100 60 5
 *
 * Zoom is the mouse wheel, clamped 0.5 to 4.0, so max OUT is 0.5: ten notches down from the default 1.0.
 * Map size is the grid panel's own Columns/Rows fields, driven the way a person drives them.
 */
import { chromium } from 'playwright'
import { BASE } from './base.mjs'
const LABEL = process.argv[2] ?? 'Woodland city'
const CATEGORY = process.argv[3] ?? 'city'
const COLS = Number(process.argv[4] ?? 100)
const ROWS = Number(process.argv[5] ?? 60)
const SECONDS = Number(process.argv[6] ?? 5)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.addInitScript(() => {
  const w = window
  w.__frames = 0
  w.__ops = {}
  const raf = w.requestAnimationFrame.bind(w)
  w.requestAnimationFrame = cb => raf(t => { w.__frames++; return cb(t) })
  const nameOf = c => (c && c.canvas && (c.canvas.className || c.canvas.id)) || '(offscreen)'
  for (const name of ['drawImage', 'fill', 'save']) {
    const orig = CanvasRenderingContext2D.prototype[name]
    CanvasRenderingContext2D.prototype[name] = function (...args) {
      const k = `${nameOf(this)}|${name}`
      w.__ops[k] = (w.__ops[k] ?? 0) + 1
      return orig.apply(this, args)
    }
  }
})
await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// THE MAP SIZE, through the panel a person uses.
const setField = async (aria, value) => {
  const f = page.getByLabel(aria, { exact: false }).first()
  if (await f.count() === 0) return false
  await f.fill(String(value))
  await f.press('Enter').catch(() => {})
  return true
}
await setField('Map columns', COLS)
await setField('Map rows', ROWS)
await page.waitForTimeout(600)

if (CATEGORY !== 'wilderness') { await page.selectOption('select', CATEGORY).catch(() => {}); await page.waitForTimeout(500) }
await page.getByRole('button', { name: new RegExp('^' + LABEL) }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Build this world/ }).click()
await page.waitForTimeout(9000)

// MAX ZOOM OUT. The handler is bound to the CANVAS with {passive:false}, so the event is dispatched there
// directly: a synthesised pointer wheel does not reliably land on it.
await page.evaluate(() => {
  const c = document.querySelector('canvas.nebcanvas') ?? document.querySelector('canvas')
  if (!c) return
  for (let i = 0; i < 12; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(900)

const seen = await page.evaluate(() => ({ cull: window.__isoCull, zoom: document.body.innerText.match(/(\d+)%/)?.[1] }))
console.log(`map ${COLS}x${ROWS}  cull=${JSON.stringify(seen.cull)}`)

await page.evaluate(() => { window.__frames = 0; window.__ops = {} })
await page.keyboard.down('w'); await page.keyboard.down('d')
const t0 = Date.now()
await page.waitForTimeout(SECONDS * 1000)
const el = (Date.now() - t0) / 1000
await page.keyboard.up('w'); await page.keyboard.up('d')
const { ops, frames } = await page.evaluate(() => ({ ops: window.__ops, frames: window.__frames }))
console.log(`\nfps ${(frames / el).toFixed(1)}   (${frames} frames in ${el.toFixed(1)}s)`)
for (const [k, n] of Object.entries(ops).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  console.log(`  ${(n / Math.max(1, frames)).toFixed(0).padStart(6)}/frame  ${k}`)
}
await browser.close()
