/** WHAT THE RIVER ACTUALLY IS on a built map, read from the grid rather than guessed off pixels. */
import { chromium } from 'playwright'
const preset = process.env.PRESET || 'Woodland'
const opts = JSON.parse(process.env.OPTS || '{}')

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: new RegExp('^' + preset) }).first().click()
await p.waitForTimeout(400)
for (const [label, value] of Object.entries(opts)) {
  await p.evaluate(([label, value]) => {
    for (const s of document.querySelectorAll('select')) {
      const text = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '')
      if (!text.trim().startsWith(label)) continue
      const opt = [...s.options].find(o => o.text === value || o.text.startsWith(value) || o.value === value)
      if (!opt) return
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, opt.value)
      s.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }, [label, value])
  await p.waitForTimeout(200)
}
if (process.env.SEED) {
  await p.evaluate(seed => {
    let t = Number(seed) >>> 0
    Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 }
  }, process.env.SEED)
}
await p.getByRole('button', { name: /Build this world/i }).first().click()
await p.waitForTimeout(4000)

const report = await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  if (!g) return { error: 'no grid' }
  const water = [], decks = [], flows = {}
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const f = g.floorAt(c, r)
    const k = f?.tileKey || ''
    if (/water|swamp|ice|frozen/.test(k)) water.push({ c, r, k, flow: f.flow, color: f.color, h: f.height })
    if (/bridge|plank|deck/.test(k)) decks.push({ c, r, k })
  }
  for (const w of water) flows[String(w.flow)] = (flows[String(w.flow)] || 0) + 1
  const labels = {}
  for (const w of water) labels[w.k] = (labels[w.k] || 0) + 1
  const colors = {}
  for (const w of water) colors[String(w.color)] = (colors[String(w.color)] || 0) + 1
  const deckLabels = {}
  for (const d of decks) deckLabels[d.k] = (deckLabels[d.k] || 0) + 1
  // composition stamps on the map
  const comps = (g.compositions || []).map(x => `${x.kind}@${x.col},${x.row} rot${x.rotation ?? 0}`)
  // bounding box of the deck run
  const bbox = decks.length ? {
    c0: Math.min(...decks.map(d => d.c)), c1: Math.max(...decks.map(d => d.c)),
    r0: Math.min(...decks.map(d => d.r)), r1: Math.max(...decks.map(d => d.r)),
  } : null
  // How often two ADJACENT water cells disagree about their axis. That is what "randomly aligned" looks
  // like on screen; a global split just means the river turns, which a river is allowed to do.
  const axisOf = f => (f === 0 || f === 2) ? 0 : 1
  const at = new Map(water.map(w => [w.c + ',' + w.r, w]))
  let pairs = 0, disagree = 0
  for (const w of water) for (const [dc, dr] of [[1,0],[0,1]]) {
    const n = at.get((w.c+dc) + ',' + (w.r+dr))
    if (!n || w.flow === undefined || n.flow === undefined) continue
    pairs++
    if (axisOf(w.flow) !== axisOf(n.flow)) disagree++
  }
  return { neighbourPairs: pairs, disagreeing: disagree, cols: g.cols, rows: g.rows, waterCount: water.length, labels, colors, flows,
           deckCount: decks.length, deckLabels, bbox, comps, water }
})
console.log(JSON.stringify(report, null, 1))
await b.close()
