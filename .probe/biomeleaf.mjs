// THE FAMILY SHEET FOR FOLIAGE COLOUR: build one map per biome, in a given season, and report every distinct
// leaf tone it actually placed. Three axes are only checkable across the whole set at once.
import { chromium } from 'playwright'
const SEASON = process.env.SEASON || 'spring'
const BIOMES = (process.env.BIOMES || 'Woodland,Jungle,Beach,Desert,Mountain,Swamp,Meadow').split(',')
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })
for (const biome of BIOMES) {
  await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
  await p.waitForTimeout(3000)
  // the season <select> has no label text, so match on its OPTIONS, never on a nearby string
  await p.evaluate(s => {
    for (const sel of document.querySelectorAll('select')) {
      if ([...sel.options].some(o => /spring/i.test(o.textContent || ''))) {
        const hit = [...sel.options].find(o => new RegExp(s, 'i').test(o.textContent || ''))
        if (hit) { sel.value = hit.value; sel.dispatchEvent(new Event('change', { bubbles: true })) }
        return
      }
    }
  }, SEASON)
  await p.waitForTimeout(400)
  const armed = await p.getByRole('button', { name: new RegExp('^' + biome) }).first().click().then(() => true).catch(() => false)
  if (!armed) { console.log(`${biome.padEnd(9)} NOT FOUND`); continue }
  await p.waitForTimeout(500)
  await p.getByRole('button', { name: /Build this world/ }).click()
  await p.waitForTimeout(3500)
  const tones = await p.evaluate(() => globalThis.__leafTones?.())
  if (!tones || tones.length === 0) { console.log(`${biome.padEnd(9)} no leaf cells placed`); continue }
  const total = tones.reduce((n, t) => n + t.count, 0)
  console.log(`${biome.padEnd(9)} ${String(tones.length).padStart(2)} tones over ${String(total).padStart(4)} leaf cells  ${tones.slice(0, 5).map(t => `${t.color}x${t.count}`).join(' ')}`)
}
await b.close()
