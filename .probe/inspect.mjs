import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: /^Woodland/ }).first().click()
await p.waitForTimeout(300)
await p.evaluate(() => {
  for (const s of document.querySelectorAll('select')) {
    const t = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '').trim()
    const pick = t.startsWith('River') ? 'Divides' : null
    if (!pick) continue
    const o = [...s.options].find(o => o.text.startsWith(pick))
    const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true }))
  }
})
await p.waitForTimeout(400)
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(6000)
console.log(JSON.stringify(await p.evaluate(() => {
  const g = window.__nebulithGrid
  if (!g) return { error: 'no grid seam' }
  const water = g.assets.filter(a => (a.tileKey || '').includes('water') || (a.label || '').includes('water'))
  const withFlow = water.filter(a => a.flow !== undefined)
  const sample = water.slice(0, 6).map(a => ({ col: a.col, row: a.row, type: a.type, tileKey: a.tileKey, label: a.label, flow: a.flow, height: a.height, heightLevel: a.heightLevel, shape: a.shape }))
  return { totalAssets: g.assets.length, waterAssets: water.length, waterWithFlow: withFlow.length, flows: [...new Set(water.map(a => a.flow))], sample }
}), null, 1))
await b.close()
