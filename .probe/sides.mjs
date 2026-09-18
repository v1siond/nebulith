import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
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
console.log(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const byTile = {}
  let cliffNoBody = 0
  const missing = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const f = g.floorAt(c, r); if (!f) continue
    const k = f.tileKey || '?'
    byTile[k] = byTile[k] || { n: 0, side: f.sideColor ?? null, color: f.color ?? null, h: f.height ?? null, img: (f.art||{}).image ? "yes" : "no" }
    byTile[k].n++
    // does this cell stand ABOVE any neighbour (so it needs a cliff face drawn)?
    const here = g.getHeight(c, r)
    const above = [[1,0],[-1,0],[0,1],[0,-1]].some(([dc,dr]) => {
      const nc=c+dc, nr=r+dr
      return nc>=0 && nr>=0 && nc<g.cols && nr<g.rows && g.getHeight(nc,nr) < here
    })
    if (above && !f.sideColor) { cliffNoBody++; if (missing.length < 6) missing.push({ at:`${c},${r}`, tile:k }) }
  }
  return JSON.stringify({ cliffCellsWithNoBodyColour: cliffNoBody, missing, byTile }, null, 1)
}))
await b.close()
