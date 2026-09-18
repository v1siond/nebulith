import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1200, height: 800 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
await p.getByRole('button', { name: /^Woodland/ }).first().click(); await p.waitForTimeout(500)
console.log('season controls:', await p.evaluate(() => [...document.querySelectorAll('select')].map(s => {
  const l = (s.closest('label')?.innerText || '').split('\n')[0].trim()
  return `${l}="${s.options[s.selectedIndex]?.text}"`
}).join(' | ')))
const set = await p.evaluate(() => {
  for (const sel of document.querySelectorAll('select')) {
    // THE SEASON SELECT CARRIES NO LABEL TEXT. Matching on the label found nothing and the probe silently
    // built spring while reporting autumn. Match on the OPTIONS instead: the select that offers seasons is
    // the season select.
    const opts = [...sel.options].map(o => o.text.toLowerCase())
    if (!opts.includes('autumn') || !opts.includes('spring')) continue
    const o = [...sel.options].find(x => /autumn/i.test(x.text))
    if (!o) return 'no autumn option'
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, o.value)
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return 'set to ' + o.text
  }
  return 'no season select found'
})
console.log('season set:', set)
await p.waitForTimeout(800)
await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(3000)
console.log(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const by = {}
  for (const a of (g.assets || [])) if (/^crown_/.test(a.label ?? '')) by[a.color ?? 'none'] = (by[a.color ?? 'none'] ?? 0) + 1
  return 'crown shades on the built map: ' + JSON.stringify(by)
}))
await b.close()
