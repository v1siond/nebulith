/** The WHOLE map of one template, zoomed out, so a pathway can be judged as a network rather than a cell. */
import { chromium } from 'playwright'
const PRESET = process.env.PRESET, VARIANT = process.env.VARIANT, OUT = process.env.OUT, NAME = process.env.NAME
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(5000)
await p.getByRole('button', { name: new RegExp('^' + PRESET) }).first().click().catch(() => {})
await p.waitForTimeout(600)
const picked = await p.evaluate(v => {
  const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.trim() === v))
  if (!sel) return 'NO SELECT for ' + v
  const opt = [...sel.options].find(o => o.textContent.trim() === v)
  sel.value = opt.value
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  return v
}, VARIANT)
await p.waitForTimeout(800)
await p.evaluate(() => { let t = 99; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(6000)
for (let i = 0; i < 8; i++) { const x = p.locator('button', { hasText: /^✕$/ }).first(); if (await x.count().catch(() => 0)) { await x.click().catch(() => {}); await p.waitForTimeout(150) } else break }
await p.keyboard.press('Escape').catch(() => {})
await p.waitForTimeout(600)
const cv = await p.locator('canvas').first().boundingBox()
await p.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2)
// zoom OUT so the whole network is in frame
for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, 240); await p.waitForTimeout(150) }
await p.waitForTimeout(1500)
await p.screenshot({ path: `${OUT}/${NAME}.png`, clip: { x: cv.x, y: cv.y, width: cv.width, height: cv.height } })
const what = await p.evaluate(() => {
  const g = window.__nebulithGrid
  if (!g) return 'no grid seam'
  const tally = {}
  for (const row of (g.ground ?? [])) for (const t of row) tally[t] = (tally[t] ?? 0) + 1
  return Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 8)
})
console.log('WROTE', NAME, '| picked:', picked, '| ground:', JSON.stringify(what))
await b.close()
