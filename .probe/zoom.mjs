import { chromium } from 'playwright'
const preset = process.env.PRESET || 'Meadow'
const opts = JSON.parse(process.env.OPTS || '{}')
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: new RegExp('^' + preset) }).first().click()
await p.waitForTimeout(400)
for (const [label, value] of Object.entries(opts)) {
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
await p.getByRole('button', { name: /Build this world/i }).first().click()
await p.waitForTimeout(3500)
// zoom in hard on the bridge: find a deck cell and centre it
const at = await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const deck = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const k = g.floorAt(c, r)?.tileKey || ''
    if (/bridge|plank|cobble/.test(k)) deck.push([c, r])
  }
  if (!deck.length) return null
  const mid = deck[Math.floor(deck.length / 2)]
  return { col: mid[0], row: mid[1], n: deck.length }
})
console.log('deck centre', JSON.stringify(at))
const canvas = await p.$('canvas')
const box = await canvas.boundingBox()
for (let i = 0; i < 6; i++) { await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.wheel(0, -240); await p.waitForTimeout(120) }
await p.waitForTimeout(900)
await canvas.screenshot({ path: `/home/visiond/.claude/jobs/beedf1c6/tmp/shots/${process.env.TAG || 'zoom'}.png` })
await b.close()
