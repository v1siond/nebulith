import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
p.on('console', m => { const t = m.text(); if (/\[layer\]|\[water\]/.test(t)) console.log('[page]', t.slice(0, 160)) })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
const pick = async (label, value) => p.evaluate(([label, value]) => {
  for (const s of document.querySelectorAll('select')) {
    const t = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '')
    if (!t.trim().startsWith(label)) continue
    const o = [...s.options].find(x => x.text === value || x.text.startsWith(value) || x.value === value)
    if (!o) return false
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, o.value)
    s.dispatchEvent(new Event('change', { bubbles: true })); return true
  }
  return false
}, [label, value])
await p.getByRole('button', { name: new RegExp('^' + (process.env.PRESET || 'Woodland')) }).first().click()
await p.waitForTimeout(500)
console.log('river picked:', await pick('River', process.env.RIVER || 'Winds through'))
console.log('water set picked:', await pick('Kind of water', process.env.WATERSET || 'Smooth water'))
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3200)
console.log(await p.evaluate(() => {
  const t = {}
  for (const r of globalThis.__nebulithGrid.groundSlugs()) for (const s of r) t[s] = (t[s] ?? 0) + 1
  return 'FINAL GROUND: ' + JSON.stringify(t)
}))
await b.close()
