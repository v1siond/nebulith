// Cells wearing the WATER COLOUR whose ground tile is not water. A flat blue wedge with no wave texture
// cannot come from a water tile, so if this count is non-zero that is what is being drawn.
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
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3000)
console.log(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const rows = g.groundSlugs()
  // The floor assets carry the colour the generator wrote.
  const byCell = new Map()
  for (const a of (g.assets || [])) if (a.type === 'floor') byCell.set(`${a.col},${a.row}`, a)
  const tally = {}
  let bleed = 0, samples = []
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
    const slug = rows[r][c]
    const a = byCell.get(`${c},${r}`)
    const col = a?.color
    if (!col) continue
    const isWater = /^water_/.test(slug)
    tally[`${isWater ? 'water' : 'land'} ${col}`] = (tally[`${isWater ? 'water' : 'land'} ${col}`] ?? 0) + 1
    if (!isWater && /^#(4f93b3|3f86b0|4a8fbf|2aa8c0)$/i.test(col)) { bleed++; if (samples.length < 6) samples.push(`${c},${r} slug=${slug} colour=${col}`) }
  }
  // Which water cells have NO floor asset at all, and what piece are they wearing?
  const missing = {}
  let noAsset = 0
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
    const slug = rows[r][c]
    if (!/^water_/.test(slug)) continue
    const a = byCell.get(`${c},${r}`)
    if (!a) { noAsset++; missing[slug + ' NO-FLOOR-ASSET'] = (missing[slug + ' NO-FLOOR-ASSET'] ?? 0) + 1 }
    else if (!a.color) missing[slug + ' no-colour'] = (missing[slug + ' no-colour'] ?? 0) + 1
  }
  return 'BY KIND+COLOUR: ' + JSON.stringify(tally) + '\nLAND CELLS WEARING A WATER COLOUR: ' + bleed +
    '\nWATER CELLS WITH NO FLOOR ASSET: ' + noAsset + ' ' + JSON.stringify(missing)
}))
await b.close()
