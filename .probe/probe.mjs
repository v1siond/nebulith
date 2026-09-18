import { chromium } from 'playwright'
const URL = process.env.URL || 'http://localhost:6328/templates'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(4000)
// what controls exist?
const controls = await p.evaluate(() => {
  const out = []
  document.querySelectorAll('select').forEach(s => {
    const label = s.closest('label')?.innerText || s.previousElementSibling?.textContent || s.getAttribute('aria-label') || ''
    out.push({ kind: 'select', label: label.trim().slice(0, 40), options: [...s.options].map(o => o.text).slice(0, 8), value: s.value })
  })
  document.querySelectorAll('button').forEach(x => { const t = (x.innerText || '').trim(); if (t) out.push({ kind: 'button', text: t.slice(0, 40) }) })
  out.push({ kind: 'canvas', n: document.querySelectorAll('canvas').length })
  return out
})
console.log(JSON.stringify(controls, null, 1))
await p.screenshot({ path: '/home/visiond/.claude/jobs/beedf1c6/tmp/shots/00-landing.png' })
await b.close()
