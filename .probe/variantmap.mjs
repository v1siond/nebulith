/** Render ONE forest variant's whole map. THIS is the reference an entrance must match: the wood it opens
 *  onto, not a stock photo of somebody else's forest. */
import { chromium } from 'playwright'
const PRESET = process.env.PRESET, VARIANT = process.env.VARIANT, OUT = process.env.OUT, NAME = process.env.NAME
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(5000)
await p.getByRole('button', { name: new RegExp('^' + PRESET) }).first().click().catch(() => {})
await p.waitForTimeout(600)
const picked = await p.evaluate(v => {
  const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.trim() === v))
  if (!sel) return 'no select'
  const opt = [...sel.options].find(o => o.textContent.trim() === v)
  sel.value = opt.value
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  return v
}, VARIANT)
await p.waitForTimeout(700)
await p.evaluate(() => { let t = 99; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(5500)
for (let i = 0; i < 6; i++) { const x = p.locator('button', { hasText: /^✕$/ }).first(); if (await x.count().catch(() => 0)) { await x.click().catch(() => {}); await p.waitForTimeout(150) } else break }
await p.keyboard.press('Escape').catch(() => {})
const cv = await p.locator('canvas').first().boundingBox()
await p.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2)
for (let i = 0; i < 2; i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(120) }
await p.waitForTimeout(1200)
await p.screenshot({ path: `${OUT}/${NAME}.png`, clip: { x: cv.x + cv.width * 0.22, y: cv.y + cv.height * 0.12, width: cv.width * 0.5, height: cv.height * 0.62 } })
console.log('WROTE', NAME, 'picked:', picked)
await b.close()
