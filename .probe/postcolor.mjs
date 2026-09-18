/** What colour does a stamped bridge POST actually carry? The composition cell says the rail's wood. */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
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
await p.getByRole('button', { name: /^Woodland/ }).first().click(); await p.waitForTimeout(400)
await pick('River', 'Winds through'); await pick('Exits', '2'); await pick('Pathways', '2')
await p.evaluate(() => { let t = 5; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3200)
console.log(JSON.stringify(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const near = (a, b) => Math.abs(a.col - b.col) <= 6 && Math.abs(a.row - b.row) <= 6
  const deck = (g.assets || []).filter(a => (a.label ?? '') === 'bridge_deck')[0]
  if (!deck) return { noDeck: true }
  const around = (g.assets || []).filter(a => near(a, deck))
  const byLabel = {}
  for (const a of around) {
    const k = a.label ?? a.tileKey ?? '?'
    if (byLabel[k]) continue
    byLabel[k] = { color: a.color, thickness: a.thickness, scaleX: a.scaleX, scaleZ: a.scaleZ, scaleY: a.scaleY, depth: a.depth, depthDir: a.depthDir, level: a.heightLevel }
  }
  return byLabel
}), null, 1))
await b.close()
