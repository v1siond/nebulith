// THE WATER PIECES, BY NAME, as a map. c = an interior piece, E = an edge or corner piece, . = not water.
// "borders in the middle of the river" is a claim about WHICH cells got edge pieces, so it is checked here
// and not from a screenshot.
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
await p.getByRole('button', { name: new RegExp('^' + (process.env.PRESET || 'Jungle')) }).first().click(); await p.waitForTimeout(500)
// TURN THE RIVER ON. It is an ELEMENT button ("Water"), not a checkbox, which is why an earlier pass built
// nine maps with no river in them and reported no water pieces.
await p.getByRole('button', { name: /^Water$/ }).first().click().catch(() => {})
await p.waitForTimeout(700)
await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(4500)
const out = await p.evaluate(() => {
  const cells = globalThis.__groundSlugs(0, 0, 39, 39) || []
  const by = new Map(cells.map(c => [`${c.col},${c.row}`, c.slug]))
  const tally = new Map()
  const rows = []
  for (let r = 0; r < 40; r++) {
    let line = ''
    for (let c = 0; c < 40; c++) {
      const s = by.get(`${c},${r}`) || ''
      if (!/water|lava/i.test(s)) { line += '.'; continue }
      tally.set(s, (tally.get(s) || 0) + 1)
      line += /_c$|still|_center$/.test(s) ? 'c' : 'E'
    }
    rows.push(line)
  }
  const all = new Map()
  for (const c of cells) all.set(c.slug, (all.get(c.slug) || 0) + 1)
  return { rows, tally: [...tally].sort((a, b) => b[1] - a[1]), cells: cells.length,
           all: [...all].sort((a, b) => b[1] - a[1]).slice(0, 14) }
})
console.log(out.rows.filter(r => /[cE]/.test(r)).slice(0, 16).join('\n'))
console.log('WATER PIECES:', JSON.stringify(out.tally))
console.log('CELLS SEEN:', out.cells)
console.log('ALL GROUND:', JSON.stringify(out.all))
await b.close()
