import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
const imgs = new Set()
p.on('request', r => { const u = r.url(); if (u.includes('/tiles/')) imgs.add(u.split('/tiles/')[1]) })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: /^Meadow/ }).first().click()
await p.waitForTimeout(400)
for (const [label, value] of Object.entries({Exits:'2',Pathways:'2',River:'Winds through','Kind of crossing':'Wooden bridge'})) {
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
await p.evaluate(() => { let t = 5; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(5000)
const cells = await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const out = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const f = g.floorAt(c, r)
    if (f?.tileKey === 'water_bend') out.push({ at: `${c},${r}`, flow: f.flow, color: f.color })
  }
  return out
})
console.log('bend cells:', JSON.stringify(cells))
console.log('bend image requested:', [...imgs].filter(u => u.includes('water_bend')))
await b.close()
