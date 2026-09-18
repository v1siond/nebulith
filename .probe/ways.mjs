import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: new RegExp('^' + (process.env.PRESET || 'Woodland')) }).first().click()
await p.waitForTimeout(300)
await p.evaluate(opts => {
  for (const s of document.querySelectorAll('select')) {
    const t = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '').trim()
    for (const [label, value] of Object.entries(opts)) {
      if (!t.startsWith(label)) continue
      const o = [...s.options].find(o => o.text === value || o.text.startsWith(value))
      if (!o) continue
      const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }
}, JSON.parse(process.env.OPTS))
await p.waitForTimeout(400)
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(6000)
console.log(JSON.stringify(await p.evaluate(() => {
  const g = window.__nebulithGrid
  const cols = g.cols, rows = g.rows
  // A "way out" = a walkable road/path tile sitting ON the border.
  const PATH = /path|road|cobble|dirt|trail|bridge|stone/
  const sides = { north: 0, south: 0, west: 0, east: 0 }
  const cellsBySide = { north: [], south: [], west: [], east: [] }
  for (const a of g.assets) {
    const key = `${a.tileKey || ''}${a.label || ''}`
    if (!PATH.test(key)) continue
    if (a.row === 0) { sides.north++; cellsBySide.north.push(a.col) }
    if (a.row === rows - 1) { sides.south++; cellsBySide.south.push(a.col) }
    if (a.col === 0) { sides.west++; cellsBySide.west.push(a.row) }
    if (a.col === cols - 1) { sides.east++; cellsBySide.east.push(a.row) }
  }
  // how many DISTINCT openings (contiguous runs) per side
  const runs = arr => { const s = [...new Set(arr)].sort((x, y) => x - y); let n = 0
    for (let i = 0; i < s.length; i++) if (i === 0 || s[i] !== s[i-1] + 1) n++; return n }
  const colAt = {}
  for (const a of g.assets) if (a.type === 'floor') colAt[`${a.col},${a.row}`] = a.color
  const colourTally = {}
  for (const c of Object.values(colAt)) colourTally[c] = (colourTally[c] || 0) + 1
  const borderCol = {}
  for (const [k, c] of Object.entries(colAt)) {
    const [cc, rr] = k.split(',').map(Number)
    if (cc === 0 || rr === 0 || cc === cols - 1 || rr === rows - 1) borderCol[c] = (borderCol[c] || 0) + 1
  }
  const tally = {}
  for (const a of g.assets) { const k = a.tileKey || a.label || a.type; tally[k] = (tally[k] || 0) + 1 }
  const border = {}
  for (const a of g.assets) {
    if (!(a.row === 0 || a.row === rows - 1 || a.col === 0 || a.col === cols - 1)) continue
    const k = a.tileKey || a.label || a.type; border[k] = (border[k] || 0) + 1
  }
  return { cols, rows, floorColours: colourTally, borderColours: borderCol, distinctOpenings: Object.fromEntries(Object.entries(cellsBySide).map(([k, v]) => [k, runs(v)])),
           allTiles: Object.fromEntries(Object.entries(tally).sort((a,b)=>b[1]-a[1]).slice(0,14)),
           borderTiles: border }
}), null, 1))
await b.close()
