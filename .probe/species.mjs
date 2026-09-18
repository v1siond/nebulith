// THE FAMILY SHEET FOR SPECIES: which trees each biome actually grows.
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
for (const biome of (process.env.BIOMES || 'Woodland,Meadow,Desert,Beach,Swamp').split(',')) {
  await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
  await p.waitForTimeout(3000)
  // THE CATEGORY IS A SELECT, the biome a button. A settlement is not a top-level button, so matching only
  // buttons reported every town as NOT FOUND while the data was fine.
  if (process.env.CATEGORY) {
    await p.evaluate(cat => {
      for (const sel of document.querySelectorAll('select')) {
        const hit = [...sel.options].find(o => new RegExp('^' + cat, 'i').test(o.text))
        if (!hit) continue
        Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, hit.value)
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        return
      }
    }, process.env.CATEGORY)
    await p.waitForTimeout(700)
  }
  const ok = await p.getByRole('button', { name: new RegExp('^' + biome) }).first().click().then(() => true).catch(() => false)
  if (!ok) { console.log(biome, 'NOT FOUND'); continue }
  await p.waitForTimeout(400)
  await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(3800)
  const kinds = await p.evaluate(() => globalThis.__treeKinds?.())
  console.log(`${biome.padEnd(9)} ${(kinds || []).map(k => `${k.kind}x${k.count}`).join('  ')}`)
}
await b.close()
