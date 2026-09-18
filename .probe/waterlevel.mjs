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
await p.getByRole('button', { name: /^Woodland/ }).first().click(); await p.waitForTimeout(500)
await pick('River', 'Winds through')
// What depth choices exist, and which is selected by default?
console.log(await p.evaluate(() => [...document.querySelectorAll('select')].map(s => {
  const lbl = (s.closest('label')?.innerText || '').split('\n')[0].trim()
  return `${lbl} = "${s.options[s.selectedIndex]?.text}" of [${[...s.options].map(o => o.text).join(' | ')}]`
}).filter(x => /depth|river|water/i.test(x)).join('\n')))
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3000)
console.log(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid, rows = g.groundSlugs()
  const ev = g.elevationAt ? null : null
  const levels = {}
  const assets = g.assets || []
  // elevation per cell, however the grid exposes it
  const el = g.elevation || g.elevations || null
  let out = 'no elevation accessor'
  if (el) {
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
      const k = /^water_/.test(rows[r][c]) ? 'water' : 'land'
      const v = el[r]?.[c] ?? 0
      levels[`${k}@${v}`] = (levels[`${k}@${v}`] ?? 0) + 1
    }
    out = JSON.stringify(levels)
  }
  return 'ELEVATION BY KIND: ' + out + ' | grid keys: ' + Object.keys(g).slice(0, 25).join(',')
}))
await b.close()
