/**
 * WHERE THE FRAME GOES. A CPU profile of the real page while the hero walks, so the optimisation is aimed at
 * what is actually expensive rather than at what looks expensive.
 *
 *     bin/e2e profile "Woodland city" city 6
 */
import { chromium } from 'playwright'
import { BASE } from './base.mjs'
const LABEL = process.argv[2] ?? 'Woodland city'
const CATEGORY = process.argv[3] ?? 'city'
const SECONDS = Number(process.argv[4] ?? 6)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
if (CATEGORY !== 'wilderness') { await page.selectOption('select', CATEGORY).catch(() => {}); await page.waitForTimeout(600) }
await page.getByRole('button', { name: new RegExp('^' + LABEL) }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Build this world/ }).click()
await page.waitForTimeout(6000)

const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
await cdp.send('Profiler.start')
await page.keyboard.down('w'); await page.keyboard.down('d')
await page.waitForTimeout(SECONDS * 1000)
await page.keyboard.up('w'); await page.keyboard.up('d')
const { profile } = await cdp.send('Profiler.stop')

// Self time per function, from the sample hit counts.
const byId = new Map(profile.nodes.map(n => [n.id, n]))
const self = new Map()
for (const n of profile.nodes) {
  if (!n.hitCount) continue
  const f = n.callFrame
  const name = `${f.functionName || '(anonymous)'}  ${String(f.url).split('/').pop()}:${f.lineNumber + 1}`
  self.set(name, (self.get(name) ?? 0) + n.hitCount)
}
const total = [...self.values()].reduce((a, b) => a + b, 0)
console.log(`samples ${total} over ${SECONDS}s\n`)
for (const [name, hits] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)) {
  console.log(`${String((hits / total * 100).toFixed(1)).padStart(5)}%  ${String(hits).padStart(6)}  ${name}`)
}
await browser.close()
