import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: new RegExp('^' + (process.env.PRESET || 'Woodland')) }).first().click()
await p.waitForTimeout(400)
await p.evaluate(() => { let t = 5; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/i }).first().click()
await p.waitForTimeout(4000)
console.log(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const a = g.assets
  const list = Array.isArray(a) ? a : [...(a?.values?.() ?? [])].flat()
  const sample = list[0]
  const counts = {}
  const onDeck = []
  for (const x of list) {
    const slug = x.slug || x.label || x.kind || x.tileKey || '?'
    counts[slug] = (counts[slug] || 0) + 1
    if (x.row >= 16 && x.row <= 24) onDeck.push(`${slug}@${x.col},${x.row}`)
  }
  const bridgey = Object.entries(counts).filter(([k]) => /bridge|rail|deck|plank/.test(k))
  return JSON.stringify({ total: list.length, sampleKeys: sample ? Object.keys(sample) : null,
    bridgey, topSlugs: Object.entries(counts).sort((x,y)=>y[1]-x[1]).slice(0,14) }, null, 1)
}))
await b.close()
