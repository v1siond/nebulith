/** Dump the road-run assets over the hole, plus what the tileset resolves for their label. */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
p.on('console', m => { const t = m.text(); if (/error|fail|Error/i.test(t)) console.log('PAGE>', t.slice(0, 200)) })
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
await p.getByRole('button', { name: /^Jungle/ }).first().click(); await p.waitForTimeout(400)
await pick('River', 'Winds through'); await pick('Exits', '2'); await pick('Pathways', '2')
await p.evaluate(() => { let t = 5; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3500)
console.log(JSON.stringify(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const want = [[17,38],[18,39],[20,32],[15,32],[17,37]]
  const assets = want.map(([c,r]) => {
    const a = (g.assets||[]).find(a => a.col===c && a.row===r)
    return a ? JSON.parse(JSON.stringify(a)) : { col:c, row:r, MISSING:true }
  })
  // every distinct label in the grid whose asset count is a z-width run
  const runs = {}
  for (const a of (g.assets||[])) if ((a.depth??1) > 1) runs[a.tileKey ?? 'undefined'] = (runs[a.tileKey ?? 'undefined']||0)+1
  return { assets, runs, totalAssets: (g.assets||[]).length }
}), null, 1))
await b.close()
