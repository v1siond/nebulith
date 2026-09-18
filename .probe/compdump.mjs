// DUMP WHAT A COMPOSITION ACTUALLY PLACED: every cell's real render fields, so a silhouette problem is
// diagnosed from the data rather than guessed at from a screenshot.
import { chromium } from 'playwright'
const KIND = process.env.COMP || 'cactus_saguaro'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1200, height: 800 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
await p.getByRole('button', { name: /^Meadow/ }).first().click(); await p.waitForTimeout(400)
await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(3000)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(300)
const rows = await p.evaluate(k => {
  globalThis.__clearRegion(8, 8, 14, 14)
  globalThis.__placeComposition(k, 10, 10)
  const g = globalThis.__nebulithProject?.grid ?? null
  const out = []
  for (let c = 8; c <= 14; c++) for (let r = 8; r <= 14; r++) {
    for (const a of (globalThis.__stackAt(c, r) || [])) out.push({ c, r, ...a })
  }
  return out
}, KIND)
for (const a of rows) console.log(JSON.stringify(a))
await b.close()
