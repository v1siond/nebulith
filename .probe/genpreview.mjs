/** The Preview window with its tuning controls: the randomize section must be gone. */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 800 }, deviceScaleFactor: 1 })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(4500)
const open = p.locator('button', { hasText: /Preview window/ }).first()
if (await open.count()) { await open.click(); await p.waitForTimeout(1500) }
const handle = await p.evaluateHandle(() => [...document.querySelectorAll('div')].find(d => /preview/i.test(d.getAttribute('aria-label') || '')))
const el = handle.asElement()
await el.screenshot({ path: '.probe/shots/sidebar/after-preview-window.png' })
// and the same window scrolled to its end, where the randomize section used to sit
await p.evaluate(() => { const w = [...document.querySelectorAll('div')].find(d => /preview/i.test(d.getAttribute('aria-label') || '')); const sc = [...w.querySelectorAll('*')].find(x => x.scrollHeight > x.clientHeight + 4); if (sc) sc.scrollTop = sc.scrollHeight })
await p.waitForTimeout(300)
await el.screenshot({ path: '.probe/shots/sidebar/after-preview-window-bottom.png' })
await b.close()
console.log('shot')
