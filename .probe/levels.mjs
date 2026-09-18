import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
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
await p.getByRole('button', { name: /Build this world/i }).first().click()
await p.waitForTimeout(4000)
console.log(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const out = {}
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const f = g.floorAt(c, r); if (!f) continue
    const k = f.tileKey || ''
    const kind = /water|swamp/.test(k) ? 'water' : /bridge|plank|cobble/.test(k) ? 'deck' : 'land'
    const key = `${kind} relief${g.getHeight(c, r)}`
    out[key] = (out[key] || 0) + 1
  }
  return JSON.stringify(out)
}))
await b.close()
