/** Click the hole and ask the editor which cell that was, then dump that cell and its neighbours. */
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
await p.getByRole('button', { name: /^Jungle/ }).first().click()
await p.waitForTimeout(300)
await pick('River', 'Winds through'); await pick('Exits', '2'); await pick('Pathways', '2'); await pick('How deep', 'Two blocks down')
await p.evaluate(() => { let t = 5; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3200)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(400)
const bx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(110) }
await p.waitForTimeout(1000)
// EVERY cell of the channel and its two rear neighbours, so I can see which face is missing.
console.log(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const rows = []
  for (let r = 0; r < g.rows; r++) {
    let line = ''
    for (let c = 0; c < g.cols; c++) {
      const h = g.getHeight(c, r)
      line += h === 0 ? '.' : h === -1 ? '1' : h === -2 ? '2' : String(h)
    }
    rows.push(String(r).padStart(2) + ' ' + line)
  }
  const levels = {}
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const k = g.floorAt(c, r)?.tileKey || '-'
    const h = g.getHeight(c, r)
    levels[`${k}@${h}`] = (levels[`${k}@${h}`] || 0) + 1
  }
  // EVERY cell: is there anything to draw at all?
  let none = 0, noFloor = 0
  const blanks = {}
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const f = g.floorAt(c, r)
    if (!f) { noFloor++; continue }
    const art = f.art || {}
    if (!f.color && !art.image && !art.char) { none++; blanks[f.tileKey || '?'] = (blanks[f.tileKey || '?'] || 0) + 1 }
  }
  return JSON.stringify({ slabBlocks: g.slabBlocks, cellsWithNoFloorAtAll: noFloor, cellsWithNothingToDraw: none, blanks, levels }, null, 1)
}))
await b.close()
