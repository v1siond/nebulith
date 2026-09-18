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

const report = []
for (const preset of ['Meadow', 'Woodland', 'Jungle']) {
  for (const river of ['Winds through', 'Divides the map', 'Around the edge']) {
    for (const seed of [3, 5, 8]) {
      await p.getByRole('button', { name: new RegExp('^' + preset) }).first().click()
      await p.waitForTimeout(300)
      await pick('River', river)
      await pick('Exits', '2'); await pick('Pathways', '2')
      await p.evaluate(s => { let t = Number(s) >>> 0; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } }, seed)
      await p.getByRole('button', { name: /Build this world/ }).click()
      await p.waitForTimeout(2600)
      const r = await p.evaluate(() => {
        const g = globalThis.__nebulithGrid
        let wet = 0, blank = 0
        const sample = []
        for (let row = 0; row < g.rows; row++) for (let col = 0; col < g.cols; col++) {
          const f = g.floorAt(col, row); if (!f) continue
          const k = f.tileKey || ''
          if (!/water|swamp/.test(k)) continue
          wet++
          const hasArt = !!(f.art && (f.art.image || f.art.char))
          if (!f.color && !hasArt) { blank++; if (sample.length < 3) sample.push({ at: `${col},${row}`, k, color: f.color ?? null }) }
        }
        return { wet, blank, sample }
      })
      report.push(`${preset} ${river} seed${seed}: wet=${r.wet} blank=${r.blank} ${r.blank ? JSON.stringify(r.sample) : ''}`)
    }
  }
}
console.log(report.join('\n'))
await b.close()
