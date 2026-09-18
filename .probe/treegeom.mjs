// The GEOMETRY of a placed tree: what the trunk and crown assets actually carry, and where they sit.
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
await p.getByRole('button', { name: /^Woodland/ }).first().click(); await p.waitForTimeout(400)
await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(2800)
console.log(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const byCell = new Map()
  for (const a of (g.assets || [])) {
    const k = `${a.col},${a.row}`
    if (!byCell.has(k)) byCell.set(k, [])
    byCell.get(k).push(a)
  }
  const out = []
  const cells = [...byCell.entries()].filter(([k]) => { const [c, r] = k.split(',').map(Number); return c > 4 && r > 4 && c < 35 && r < 35 })
  for (const [k, list] of cells) {
    const crown = list.find(a => /^crown_/.test(a.label ?? ''))
    const trunk = list.find(a => /^trunk/.test(a.label ?? ''))
    if (!crown || !trunk) continue
    out.push({
      cell: k,
      trunk: [trunk.label, 'lvl', trunk.heightLevel ?? 0, 'scale', trunk.scale, 'sX', trunk.scaleX, 'sY', trunk.scaleY].join(' '),
      crown: [crown.label, 'lvl', crown.heightLevel ?? 0, 'scale', crown.scale, 'sX', crown.scaleX, 'sY', crown.scaleY].join(' '),
      trunkTop: (trunk.heightLevel ?? 0) + (trunk.scaleY ?? 1),
      crownCentre: (crown.heightLevel ?? 0) + (crown.scaleY ?? 1) / 2,
    })
    if (out.length >= 4) break
  }
  return JSON.stringify(out, null, 1)
}))
await b.close()
