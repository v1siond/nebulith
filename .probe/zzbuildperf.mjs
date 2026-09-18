/** Build a world, then measure the frame cost with the map on screen. The number that matters is his. */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 900 } })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(4500)
await p.evaluate(() => {
  const s = [...document.querySelectorAll('select')][0]
  const o = [...s.options].find(o => o.textContent.trim().startsWith('Wilderness'))
  s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }))
})
await p.waitForTimeout(600)
await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('Woodland'))?.click())
await p.waitForTimeout(500)
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(7000)
for (let i = 0; i < 8; i++) { const x = p.locator('button', { hasText: /^✕$/ }).first(); if (await x.count().catch(() => 0)) { await x.click().catch(() => {}); await p.waitForTimeout(120) } else break }
await p.waitForTimeout(800)
const r = await p.evaluate(async () => {
  const w = window
  const long = []
  new PerformanceObserver(l => { for (const e of l.getEntries()) long.push(Math.round(e.duration)) }).observe({ entryTypes: ['longtask'] })
  let frames = 0
  const t0 = performance.now()
  await new Promise(res => { const tick = () => { frames++; performance.now() - t0 < 3000 ? requestAnimationFrame(tick) : res() }; requestAnimationFrame(tick) })
  const ms = performance.now() - t0
  return { fps: +(frames / (ms / 1000)).toFixed(1), longTaskMs: long.reduce((a, c) => a + c, 0), longTasks: long.length,
           iso: Math.round(w.__isoRenderMs ?? -1), assets: w.__nebulithGrid?.assets?.length ?? -1 }
})
console.log(JSON.stringify(r))
await b.close()
