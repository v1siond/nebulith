// What a tree of each kind actually DRAWS: its cells, their labels, their images.
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
for (const preset of ['Woodland', 'Beach', 'Swamp']) {
  await p.getByRole('button', { name: new RegExp('^' + preset) }).first().click(); await p.waitForTimeout(400)
  await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(2800)
  console.log(preset, await p.evaluate(() => {
    const g = globalThis.__nebulithGrid
    const byLabel = {}, images = new Set()
    for (const a of (g.assets || [])) {
      const l = a.label ?? ''
      if (!/^(leaf_|trunk|canopy_|crown_)/.test(l)) continue
      byLabel[l] = (byLabel[l] ?? 0) + 1
      if (a.art?.[0]) images.add(l + '=' + String(a.art[0]).slice(-40))
    }
    return JSON.stringify({ labels: byLabel, distinctArt: [...images].slice(0, 6) })
  }))
}
await b.close()
