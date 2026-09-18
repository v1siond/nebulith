/** Exactly what is stacked in an entrance's three cells, and at what level. */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
const pick = async (l, v) => p.evaluate(([l, v]) => {
  for (const s of document.querySelectorAll('select')) {
    const t = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '')
    if (!t.trim().startsWith(l)) continue
    const o = [...s.options].find(x => x.text === v || x.text.startsWith(v) || x.value === v)
    if (!o) return false
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, o.value)
    s.dispatchEvent(new Event('change', { bubbles: true })); return true
  }
  return false
}, [l, v])
await p.getByRole('button', { name: /^Woodland/ }).first().click(); await p.waitForTimeout(400)
await pick('River', 'Winds through'); await pick('Exits', '2'); await pick('Pathways', '2')
await p.evaluate(() => { let t = 7; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3500)
console.log(JSON.stringify(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const ups = (g.assets || []).filter(a => ['dead-tree','oak-tree'].includes(a.label ?? ''))
  if (!ups.length) return { none: true }
  const row = Math.max(...ups.map(a => a.row))
  const cols = ups.filter(a => a.row === row).map(a => a.col).sort((x, y) => x - y)
  const lo = Math.min(...cols), hi = Math.max(...cols)
  const out = []
  for (let c = lo; c <= hi; c++) for (const r of [row, row - 1]) {
    for (const a of (g.assets || []).filter(a => a.col === c && a.row === r)) {
      out.push(`${c},${r} L${a.heightLevel ?? 0} ${a.label ?? a.tileKey} type=${a.type} color=${a.color ?? '-'} h=${a.height ?? '-'} light=${a.settings?.light ? 'yes' : 'no'}`)
    }
  }
  return { row, cols, stack: out }
}), null, 1))
await b.close()
