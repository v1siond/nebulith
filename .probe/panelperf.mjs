/** Where the editor's frame time goes with the New world panel on screen. */
import { chromium } from 'playwright'
const b = await chromium.launch(['--enable-gpu'])
const p = await b.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(5000)

await p.evaluate(() => {
  window.__long = []
  new PerformanceObserver(list => { for (const e of list.getEntries()) window.__long.push(Math.round(e.duration)) })
    .observe({ entryTypes: ['longtask'] })
})
const fps = async (ms, tag) => {
  const r = await p.evaluate(async (ms) => {
    window.__long.length = 0
    let frames = 0
    const t0 = performance.now()
    await new Promise(res => {
      const tick = () => { frames++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else res() }
      requestAnimationFrame(tick)
    })
    const secs = (performance.now() - t0) / 1000
    return {
      fps: +(frames / secs).toFixed(1),
      iso: window.__isoRenderMs ?? null, twoD: window.__2dRenderMs ?? null,
      longTasks: window.__long.slice(0, 12), longTotal: window.__long.reduce((a, b) => a + b, 0),
    }
  }, ms)
  console.log(tag.padEnd(46), JSON.stringify(r))
  return r
}

await fps(2000, 'editor idle, preview shut')
const cards = p.locator('.pcard')
const n = await cards.count()
// a hover sweep across every preset card, the cursor doing what a cursor does
const t0 = Date.now()
for (let i = 0; i < n; i++) { await cards.nth(i).hover(); await p.waitForTimeout(60) }
console.log('hover sweep over', n, 'cards took', Date.now() - t0, 'ms')
await fps(2000, 'editor idle after the sweep')
await cards.nth(0).click()
await p.waitForTimeout(2000)
await fps(2000, 'preview window open')
const t1 = Date.now()
for (let i = 0; i < n; i++) { await cards.nth(i).hover(); await p.waitForTimeout(60) }
console.log('hover sweep with the preview open took', Date.now() - t1, 'ms')
await fps(2000, 'preview open, after the sweep')
// hide the editor chrome entirely: the map alone
await p.keyboard.press('Escape')
await p.evaluate(() => { const b2 = [...document.querySelectorAll('button')].find(x => /^«$/.test(x.textContent.trim())); b2?.click() })
await p.waitForTimeout(800)
await fps(2000, 'panel collapsed')
await b.close()
