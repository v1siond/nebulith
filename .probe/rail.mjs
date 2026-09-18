import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: /^Meadow/ }).first().click()
await p.waitForTimeout(400)
for (const [label, value] of Object.entries({Exits:'2',Pathways:'2',River:'Divides the map','Kind of crossing':'Wooden bridge'})) {
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
await p.getByRole('button', { name: /Build this world/i }).first().click()
await p.waitForTimeout(4000)
console.log(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const list = Array.isArray(g.assets) ? g.assets : [...(g.assets?.values?.() ?? [])].flat()
  const parts = list.filter(a => /bridge_rail|bridge_deck|post/.test(a.label || ''))
  const deck = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    if (/bridge|plank|cobble/.test(g.floorAt(c, r)?.tileKey || '')) deck.push(`${c},${r}`)
  }
  const on = new Set(deck)
  return JSON.stringify({
    rails: parts.filter(a => a.label === 'bridge_rail').map(a => ({
      at: `${a.col},${a.row}`, lvl: a.heightLevel, depth: a.depth, depthDir: a.depthDir,
      scaleZ: a.scaleZ, thickness: a.thickness, settings: a.settings && Object.keys(a.settings),
    })),
  }, null, 1)
}))
await b.close()
