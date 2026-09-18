/** The WHOLE map in frame, zoomed out, so an edge and its gates can actually be judged. */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'
const OUT = '/home/visiond/.claude/jobs/beedf1c6/tmp/shots'
mkdirSync(OUT, { recursive: true })
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })
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
const PRESET = process.env.PRESET || 'Woodland', EXITS = process.env.EXITS || '2'
await p.getByRole('button', { name: new RegExp('^' + PRESET) }).first().click(); await p.waitForTimeout(400)
await pick('River', process.env.RIVER || 'Winds through')
await pick('Exits', EXITS); await pick('Pathways', process.env.PATHS || '2')
await p.evaluate(s => { let t = s; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } }, +(process.env.SEED || 7))
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3500)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(400)
const bx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, 240); await p.waitForTimeout(90) }
await p.waitForTimeout(900)
const png = await p.evaluate(() => {
  const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  return cv.toDataURL('image/png')
})
writeFileSync(`${OUT}/${process.env.TAG || 'wholemap'}.png`, Buffer.from(png.split(',')[1], 'base64'))
console.log('saved', process.env.TAG || 'wholemap')
await b.close()
