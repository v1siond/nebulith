import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: /^Woodland/ }).first().click()
await p.waitForTimeout(400)
await p.evaluate(() => { let t = 5; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/i }).first().click()
await p.waitForTimeout(4000)
console.log(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const keys = Object.keys(g).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(g) || {}))
  const objs = g.objects || g.props || []
  const kinds = {}
  for (const o of objs) kinds[o.kind || o.type || o.label || '?'] = (kinds[o.kind || o.type || o.label || '?'] || 0) + 1
  return JSON.stringify({ keys: [...new Set(keys)], objectCount: objs.length, kinds }, null, 1)
}))
await b.close()
