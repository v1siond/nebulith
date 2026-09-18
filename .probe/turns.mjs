import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: /^Meadow/ }).first().click(); await p.waitForTimeout(300)
await p.evaluate(() => { for (const s of document.querySelectorAll('select')) {
  const t = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '').trim()
  if (!t.startsWith('River')) continue
  const o = [...s.options].find(o => o.text.startsWith('Around the edge'))
  const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })) } })
await p.waitForTimeout(400)
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(5000)
await p.evaluate(() => { delete window.__turnStats })
await p.waitForTimeout(2000)
console.log('faces drawn by turn value:', JSON.stringify(await p.evaluate(() => window.__turnStats)))
console.log('water assets by flow:', JSON.stringify(await p.evaluate(() => {
  const g = window.__nebulithGrid; const out = {}
  for (const a of g.assets) if ((a.tileKey||'').includes('water')) out[`flow=${a.flow}`] = (out[`flow=${a.flow}`]??0)+1
  return out })))
await b.close()
