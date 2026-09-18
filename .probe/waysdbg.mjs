import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: /^Woodland/ }).first().click(); await p.waitForTimeout(300)
await p.evaluate(() => { for (const s of document.querySelectorAll('select')) {
  const t = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '').trim()
  const want = t.startsWith('Exits') ? '4' : t.startsWith('Pathways') ? '4' : null
  if (!want) continue
  const o = [...s.options].find(o => o.text === want)
  const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })) } })
await p.waitForTimeout(500)
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(6000)
console.log('ways seen by the generator:', JSON.stringify(await p.evaluate(() => window.__ways)))
await b.close()
