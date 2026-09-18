import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
await p.getByRole('button', { name: /^Woodland/ }).first().click(); await p.waitForTimeout(400)
await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(3000)
console.log(await p.evaluate(async () => {
  const api = await (await fetch('http://localhost:6328/api/tilesets')).json()
  const served = (api.data[0].tiles.rock || {}).settings || {}
  const g = globalThis.__nebulithGrid
  const rocks = (g.assets || []).filter(a => (a.label ?? a.tileKey) === 'rock')
  const sample = rocks[0]
  return JSON.stringify({
    servedByApi: { display: served.display, transparent: served.transparent },
    rockAssetsOnMap: rocks.length,
    assetSettings: sample ? sample.settings : 'no rock asset',
    assetKeys: sample ? Object.keys(sample) : [],
  }, null, 1)
}))
await b.close()
