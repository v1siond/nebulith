/** Zoom until the map covers the canvas, then ANY canvas-clear pixel is a hole in the drawing. */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
const pick = async (label, value) => p.evaluate(([label, value]) => {
  for (const s of document.querySelectorAll('select')) {
    const text = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '')
    if (!text.trim().startsWith(label)) continue
    const opt = [...s.options].find(o => o.text === value || o.text.startsWith(value) || o.value === value)
    if (opt) { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, opt.value); s.dispatchEvent(new Event('change', { bubbles: true })); return true }
  }
  return false
}, [label, value])
const out = []
for (const [preset, river, seed] of [['Meadow','Divides the map',5],['Meadow','Winds through',3],['Woodland','Divides the map',8],['Jungle','Winds through',5]]) {
  await p.getByRole('button', { name: new RegExp('^' + preset) }).first().click()
  await p.waitForTimeout(300)
  await pick('River', river); await pick('Exits', '2'); await pick('Pathways', '2')
  await p.evaluate(s => { let t = Number(s) >>> 0; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } }, seed)
  await p.getByRole('button', { name: /Build this world/ }).click()
  await p.waitForTimeout(3000)
  await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
  await p.waitForTimeout(300)
  const bx = await p.locator('canvas').first().boundingBox()
  await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
  for (let i = 0; i < 7; i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(110) }
  await p.waitForTimeout(1000)
  const n = await p.evaluate(() => {
    const cv = document.querySelector('canvas')
    const { data, width, height } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
    let clear = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] === 0x1a && data[i+1] === 0x1a && data[i+2] === 0x2e) clear++
    return { clear, total: width * height }
  })
  out.push(`${preset} ${river} seed${seed}: clear=${n.clear} of ${n.total} (${(100*n.clear/n.total).toFixed(2)}%)`)
}
console.log(out.join('\n'))
await b.close()
