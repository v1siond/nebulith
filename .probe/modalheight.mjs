/** A modal with no remembered height must be as tall as its content, capped by the room between the bars. */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: Number(process.env.H||800) }, deviceScaleFactor: 1 })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(4500)
const guides = p.locator('button', { hasText: /^Guides$/ }).first()
await guides.click()
await p.waitForTimeout(900)
const r = await p.evaluate(() => {
  const bar = (s) => Math.round(document.querySelector(s)?.getBoundingClientRect().height ?? 0)
  return [...document.querySelectorAll('.mw')].map(w => {
    const body = w.querySelector('.body')
    const head = w.querySelector('.bar')
    return {
      label: w.getAttribute('aria-label'),
      inlineHeight: w.style.height || '(none)',
      cap: w.style.getPropertyValue('--mw-cap'),
      rendered: Math.round(w.getBoundingClientRect().height),
      content: Math.round((body?.scrollHeight ?? 0) + (head?.getBoundingClientRect().height ?? 0) + 2),
      bodyScrolls: body ? body.scrollHeight > body.clientHeight + 1 : null,
      topBar: bar('.z-top'), viewBar: bar('.z-bar'), viewport: window.innerHeight,
    }
  })
})
console.log(JSON.stringify(r, null, 1))
const el = await p.evaluateHandle(() => document.querySelector('.mw'))
await el.asElement().screenshot({ path: '.probe/shots/sidebar/modal-guides.png' })
await b.close()
