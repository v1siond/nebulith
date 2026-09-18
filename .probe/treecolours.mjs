// Do the trees on a real map actually wear more than one green?
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
for (const preset of ['Woodland', 'Jungle']) {
  await p.getByRole('button', { name: new RegExp('^' + preset) }).first().click(); await p.waitForTimeout(400)
  await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(3000)
  console.log(preset, await p.evaluate(() => {
    const g = globalThis.__nebulithGrid
    const leaf = (g.assets || []).filter(a => /^(leaf_|canopy_)/.test(a.label ?? ''))
    const by = {}
    for (const a of leaf) by[a.color ?? 'none'] = (by[a.color ?? 'none'] ?? 0) + 1
    return JSON.stringify({ leafCells: leaf.length, colours: by })
  }))
}
await b.close()
