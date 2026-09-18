import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1200, height: 800 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
for (const preset of ['Woodland', 'Jungle', 'Beach', 'Mountain', 'Volcanic']) {
  const btn = p.getByRole('button', { name: new RegExp('^' + preset) }).first()
  if (!(await btn.count())) continue
  await btn.click(); await p.waitForTimeout(350)
  await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(2600)
  console.log(preset.padEnd(10), await p.evaluate(() => {
    const g = globalThis.__nebulithGrid
    const by = {}
    for (const a of (g.assets || [])) if (/^crown_/.test(a.label ?? '')) by[a.color ?? 'none'] = (by[a.color ?? 'none'] ?? 0) + 1
    const kinds = new Set((g.assets || []).filter(a => /^crown_/.test(a.label ?? '')).map(a => a.label))
    return `shades ${Object.keys(by).length}  species ${kinds.size}  ${JSON.stringify(by)}`
  }))
}
await b.close()
