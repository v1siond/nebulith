/** The map CLOSE UP, panels shut, centred on the crossing: the view the bug reports are taken from. */
import { chromium } from 'playwright'
const OUT = '/home/visiond/.claude/jobs/beedf1c6/tmp/shots'
const tag = process.env.TAG || 'closeup'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 2 })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: new RegExp('^' + (process.env.PRESET || 'Meadow')) }).first().click()
await p.waitForTimeout(400)
for (const [label, value] of Object.entries(JSON.parse(process.env.OPTS || '{}'))) {
  await p.evaluate(([label, value]) => {
    for (const s of document.querySelectorAll('select')) {
      const text = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '')
      if (!text.trim().startsWith(label)) continue
      const opt = [...s.options].find(o => o.text === value || o.text.startsWith(value) || o.value === value)
      if (opt) { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, opt.value); s.dispatchEvent(new Event('change', { bubbles: true })) }
    }
  }, [label, value])
  await p.waitForTimeout(200)
}
if (process.env.SEED) await p.evaluate(seed => { let t = Number(seed) >>> 0; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } }, process.env.SEED)
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(5000)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
for (const c of await p.locator('button', { hasText: /^«$/ }).all()) await c.click().catch(() => {})
await p.waitForTimeout(500)
// Walk the player ONTO the crossing so the camera (which follows it) frames the bridge.
await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const deck = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    if (/bridge|plank|cobble/.test(g.floorAt(c, r)?.tileKey || '')) deck.push([c, r])
  }
  if (deck.length) globalThis.__nebulithFocus = deck[Math.floor(deck.length / 2)]
})
const box = await p.locator('canvas').first().boundingBox()
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
for (let i = 0; i < Number(process.env.ZOOM_IN || 5); i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(120) }
await p.waitForTimeout(1200)
await p.locator('canvas').first().screenshot({ path: `${OUT}/${tag}.png` })
console.log('saved', `${OUT}/${tag}.png`)
await b.close()
