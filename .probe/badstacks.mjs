// Cells holding a combination that cannot be right: something growing on top of a rock.
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
for (const preset of (process.env.PRESETS || 'Woodland,Jungle,Meadow,Beach,Swamp').split(',')) {
  const btn = p.getByRole('button', { name: new RegExp('^' + preset) }).first()
  if (!(await btn.count())) continue
  await btn.click(); await p.waitForTimeout(400)
  await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(2800)
  console.log(preset, await p.evaluate(() => {
    const g = globalThis.__nebulithGrid
    const byCell = new Map()
    for (const a of (g.assets || [])) {
      const k = `${a.col},${a.row}`
      if (!byCell.has(k)) byCell.set(k, [])
      byCell.get(k).push(a)
    }
    let onRock = 0
    const samples = []
    for (const [k, list] of byCell) {
      const rock = list.find(a => /^(rock|boulder)$/.test(a.label ?? a.tileKey ?? ''))
      if (!rock) continue
      const grow = list.filter(a => /^(leaf_|canopy_|trunk|bush|shrub|flower)/.test(a.label ?? ''))
      if (grow.length === 0) continue
      onRock++
      if (samples.length < 3) samples.push(`${k}: rock@${rock.heightLevel ?? 0} + ${grow.map(a => `${a.label}@${a.heightLevel ?? 0}`).join(',')}`)
    }
    return JSON.stringify({ cellsWithRock: [...byCell.values()].filter(l => l.some(a => /^(rock|boulder)$/.test(a.label ?? ''))).length, growingOnRock: onRock, samples })
  }))
}
await b.close()
