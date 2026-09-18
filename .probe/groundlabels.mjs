// Every distinct GROUND label a generated map actually writes, across several presets, asked of the grid
// rather than grepped out of the source. The grep found 4; most labels reach the grid through a variable.
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
const tally = {}
for (const preset of (process.env.PRESETS || 'Woodland,Jungle,Meadow,Beach,Swamp,Town,City,Cave,Temple,Mountain').split(',')) {
  const btn = p.getByRole('button', { name: new RegExp('^' + preset) }).first()
  if (!(await btn.count())) { console.log(preset, 'NO BUTTON'); continue }
  await btn.click(); await p.waitForTimeout(400)
  await p.getByRole('button', { name: /Build this world/ }).click()
  await p.waitForTimeout(2600)
  const seen = await p.evaluate(() => {
    const g = globalThis.__nebulithGrid
    const rows = g.groundSlugs ? g.groundSlugs() : null
    const out = {}
    if (rows) for (const r of rows) for (const s of r) out[s] = (out[s] ?? 0) + 1
    return out
  })
  for (const [k, v] of Object.entries(seen)) tally[k] = (tally[k] ?? 0) + v
  console.log(preset.padEnd(10), Object.keys(seen).length, 'distinct')
}
console.log('\nALL GROUND LABELS:')
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log('  ', k.padEnd(24), v)
await b.close()
