import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 800 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(4500)
await p.locator('.pcard').nth(0).click()
await p.waitForTimeout(1500)
console.log(JSON.stringify(await p.evaluate(() => {
  const w = document.querySelector('[role="dialog"][aria-label="Preview"]')
  const body = w.querySelector('.body')
  body.scrollTop = body.scrollHeight
  return {
    subHeadings: [...w.querySelectorAll('.sub')].map(x => x.textContent.trim()),
    randomizeAnything: /randomiz/i.test(w.textContent),
    tail: w.textContent.replace(/\s+/g, ' ').slice(-160),
  }
}), null, 1))
const el = await p.evaluateHandle(() => document.querySelector('[role="dialog"][aria-label="Preview"]'))
await el.asElement().screenshot({ path: '.probe/shots/sidebar/final-preview.png' })
await b.close()
