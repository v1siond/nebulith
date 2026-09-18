/** What ONE hover over a preset card costs the main thread, with the preview window shut and open. */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 900 } })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(5000)

const cost = async (tag, index) => {
  const r = await p.evaluate(async (i) => {
    const cards = [...document.querySelectorAll('.pcard')]
    const card = cards[i % cards.length]
    const tasks = []
    const obs = new PerformanceObserver(list => { for (const e of list.getEntries()) tasks.push(Math.round(e.duration)) })
    obs.observe({ entryTypes: ['longtask'] })
    const t0 = performance.now()
    if (i >= 0) card.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }))
    const sync = performance.now() - t0
    await new Promise(res => setTimeout(res, 900))
    obs.disconnect()
    return { syncMs: Math.round(sync), tasks, taskTotal: tasks.reduce((a, c) => a + c, 0) }
  }, index)
  console.log(tag.padEnd(40), JSON.stringify(r))
}

console.log('--- preview window SHUT ---')
for (let i = 0; i < 3; i++) await cost('CONTROL, no hover', -1)
for (let i = 0; i < 4; i++) await cost(`hover card ${i}`, i)
await p.locator('.pcard').nth(0).click()
await p.waitForTimeout(2500)
console.log('--- preview window OPEN ---')
for (let i = 0; i < 3; i++) await cost('CONTROL, no hover', -1)
for (let i = 0; i < 4; i++) await cost(`hover card ${i}`, i)
await b.close()
