// TEST THE HYPOTHESIS: is stackAt=0 why a second painted tile lands at the same level?
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: /^Meadow/ }).first().click(); await p.waitForTimeout(500)
await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(3000)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(400)

const out = await p.evaluate(() => {
  const w = globalThis
  const res = []
  let col = 4
  // one tile from each category that ROUTES to 'asset', so we see stackAt across the board
  for (const cat of ['nature', 'walls', 'props', 'roofs']) {
    const tiles = w.__paletteTiles(cat) || []
    for (const t of tiles.slice(0, 3)) {
      col += 1
      const r1 = w.__paintTile(t.id, col, 12)
      if (!r1 || r1.error || r1.route !== 'asset') continue
      w.__paintTile(t.id, col, 12)
      const st = w.__stackAt(col, 12)
      res.push({
        id: t.id, cat,
        servedStackAt: r1.tileSettings?.stackAt ?? null,
        tileHeight: r1.tileHeight,
        levels: st.map(x => x.heightLevel).join(','),
        grew: st.length,
      })
    }
  }
  return res
})
for (const r of out) {
  console.log(
    `${r.cat.padEnd(7)} ${r.id.padEnd(26)} stackAt=${String(r.servedStackAt).padEnd(5)} h=${String(r.tileHeight).padEnd(4)} levels=[${r.levels}] n=${r.grew}`)
}
await b.close()
