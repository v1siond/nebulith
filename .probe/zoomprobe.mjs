import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
const bottom = await p.evaluate(() => {
  const out = []
  document.querySelectorAll('button,select,input').forEach(el => {
    const r = el.getBoundingClientRect()
    if (r.top < window.innerHeight - 140) return
    out.push({ tag: el.tagName, text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 30), x: Math.round(r.x), y: Math.round(r.y) })
  })
  return out
})
console.log(JSON.stringify(bottom))
await b.close()
