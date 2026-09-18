/** Same map, rising zoom. Count canvas-clear pixels in the CENTRE of the frame only, where the on-canvas
 *  hint bar and Map button cannot reach. If holes grow with zoom, the visible-cell window is too small. */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
const pick = async (label, value) => p.evaluate(([label, value]) => {
  for (const s of document.querySelectorAll('select')) {
    const t = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '')
    if (!t.trim().startsWith(label)) continue
    const o = [...s.options].find(x => x.text === value || x.text.startsWith(value) || x.value === value)
    if (!o) return false
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, o.value)
    s.dispatchEvent(new Event('change', { bubbles: true })); return true
  }
  return false
}, [label, value])
await p.getByRole('button', { name: new RegExp('^' + (process.env.PRESET || 'Jungle')) }).first().click()
await p.waitForTimeout(500)
console.log('river set:', await pick('River', process.env.RIVER || 'Winds through'))
await pick('Exits', '2'); await pick('Pathways', '2')
await p.evaluate(() => { let t = 5; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3000)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(400)
const bx = await p.locator('canvas').first().boundingBox()
const centreClear = () => p.evaluate(() => {
  const cv = document.querySelector('canvas')
  const { data, width, height } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
  const x0 = Math.floor(width * 0.25), x1 = Math.floor(width * 0.75)
  const y0 = Math.floor(height * 0.25), y1 = Math.floor(height * 0.75)
  let n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * width + x) * 4
    if (data[i] === 0x1a && data[i+1] === 0x1a && data[i+2] === 0x2e) n++
  }
  return { clear: n, of: (x1 - x0) * (y1 - y0) }
})
// start fully zoomed OUT, then step in
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, 240); await p.waitForTimeout(90) }
await p.waitForTimeout(800)
for (let step = 0; step <= 12; step++) {
  const r = await centreClear()
  console.log(`zoom-in ${String(step).padStart(2)}: centre-clear ${r.clear} / ${r.of}`)
  await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
  await p.mouse.wheel(0, -240)
  await p.waitForTimeout(220)
}
await b.close()
