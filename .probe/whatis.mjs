import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: /^Woodland/ }).first().click(); await p.waitForTimeout(300)
await p.evaluate(() => { for (const s of document.querySelectorAll('select')) {
  const t = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '').trim()
  const want = t.startsWith('Exits') ? '4' : t.startsWith('Pathways') ? '2' : null
  if (!want) continue
  const o = [...s.options].find(o => o.text === want)
  const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })) } })
await p.waitForTimeout(400)
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(6000)
console.log(JSON.stringify(await p.evaluate(() => {
  const g = window.__nebulithGrid
  const near = g.assets.filter(a => a.col <= 1 || a.row <= 1 || a.col >= g.cols - 2 || a.row >= g.rows - 2)
  const tally = {}
  for (const a of near) { const k = `${a.label || a.tileKey || a.type}`; tally[k] = (tally[k] || 0) + 1 }
  const sample = near.filter(a => /lamp|post|rail|gate/.test(String(a.label || a.tileKey || a.type)))
    .slice(0, 5).map(a => ({ col: a.col, row: a.row, label: a.label, tileKey: a.tileKey, type: a.type,
      hasOverride: !!a.tileOverride, tileOverride: a.tileOverride, color: a.color, scaleY: a.scaleY }))
  return { edgeTiles: tally, gateSample: sample }
}), null, 1))
await b.close()
