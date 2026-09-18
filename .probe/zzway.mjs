/** Build one template and screenshot the whole map, so a WAY can be judged as a way. */
import { chromium } from 'playwright'
const KIND = process.env.KIND, TYPE = process.env.TYPE, SUB = process.env.SUB || '', NAME = process.env.NAME
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(4500)
await p.evaluate(k => {
  const sel = [...document.querySelectorAll('select')][0]
  const opt = [...sel.options].find(o => o.textContent.trim().startsWith(k))
  sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }))
}, KIND)
await p.waitForTimeout(700)
const clicked = await p.evaluate(t => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(t))
  if (!btn) return 'NO BUTTON ' + t
  btn.click(); return t
}, TYPE)
await p.waitForTimeout(700)
let sub = 'none'
if (SUB) {
  sub = await p.evaluate(t => {
    const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(t))
    if (!btn) return 'NO SUB ' + t
    btn.click(); return t
  }, SUB)
  await p.waitForTimeout(600)
}
await p.evaluate(() => { let t = 99; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(7000)
for (let i = 0; i < 8; i++) { const x = p.locator('button', { hasText: /^✕$/ }).first(); if (await x.count().catch(() => 0)) { await x.click().catch(() => {}); await p.waitForTimeout(150) } else break }
await p.keyboard.press('Escape').catch(() => {})
await p.waitForTimeout(500)
const cv = await p.locator('canvas').first().boundingBox()
await p.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2)
// drag the map back to the middle: the camera starts on the spawn, which is at an edge
await p.mouse.down({ button: 'middle' }).catch(() => {})
await p.mouse.up({ button: 'middle' }).catch(() => {})
for (let i = 0; i < 9; i++) { await p.mouse.wheel(0, 240); await p.waitForTimeout(140) }
await p.waitForTimeout(1500)
await p.screenshot({ path: `.probe/shots/rim/${NAME}.png` })
console.log('WROTE', NAME, '| type:', clicked, '| sub:', sub)
await b.close()
