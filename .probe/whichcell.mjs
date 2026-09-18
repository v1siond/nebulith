/** Name the CELLS that have an undrawn pixel on them. Uses the renderer's own projection (__nebulithProject)
 *  so the answer is the cell the renderer itself would put there, not one I derived from the picture. */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
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
const PRESET = process.env.PRESET || 'Jungle', RIVER = process.env.RIVER || 'Winds through', SEED = +(process.env.SEED || 5)
await p.getByRole('button', { name: new RegExp('^' + PRESET) }).first().click()
await p.waitForTimeout(400)
await pick('River', RIVER)
if (process.env.EXITS) await pick('Exits', process.env.EXITS)
if (process.env.PATHS) await pick('Pathways', process.env.PATHS)
await p.evaluate(s => { let t = s; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } }, SEED)
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3500)

const out = await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const { toScreen, tileW, tileH } = globalThis.__nebulithProject
  const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  const { data, width, height } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
  const clear = n => data[n * 4] === 0x1a && data[n * 4 + 1] === 0x1a && data[n * 4 + 2] === 0x2e
  // background = clear reachable from the border. Anything else clear is a HOLE in the drawn map.
  const seen = new Uint8Array(width * height)
  const st = []
  for (let x = 0; x < width; x++) st.push(x, 0, x, height - 1)
  for (let y = 0; y < height; y++) st.push(0, y, width - 1, y)
  while (st.length) {
    const y = st.pop(), x = st.pop()
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    const n = y * width + x
    if (seen[n] || !clear(n)) continue
    seen[n] = 1
    st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1)
  }
  // INVERSE PROJECTION. toScreen is affine in (col,row) at any camera turn, so three samples give the exact
  // inverse: a hole pixel names the ground cell under it. Cells are drawn LIFTED by height*heightStep, so the
  // pixel is also tested against the lifted plane of each candidate and the taller reading wins.
  const o = toScreen(0, 0), ec = toScreen(1, 0), er = toScreen(0, 1)
  const m = [ec.x - o.x, er.x - o.x, ec.y - o.y, er.y - o.y]
  const det = m[0] * m[3] - m[1] * m[2]
  const cellAt = (x, y) => {
    const dx = x - o.x, dy = y - o.y
    return { col: Math.round((m[3] * dx - m[1] * dy) / det), row: Math.round((-m[2] * dx + m[0] * dy) / det) }
  }
  const hits = new Map()
  let holes = 0, unclaimed = 0
  for (let n = 0; n < width * height; n++) {
    if (seen[n] || !clear(n)) continue
    holes++
    const x = n % width, y = (n / width) | 0
    const g0 = cellAt(x, y)
    if (g0.col < 0 || g0.row < 0 || g0.col >= g.cols || g0.row >= g.rows) { unclaimed++; continue }
    const key = `${g0.col},${g0.row}`
    hits.set(key, (hits.get(key) || 0) + 1)
  }
  // Was the run that OWNS each hole cell culled, or drawn and invisible?
  const cull = globalThis.__probeCull
  globalThis.__probeDrawn = globalThis.__probeDrawn || []
  const drawn = new Set(globalThis.__probeDrawn)
  const fate = k => {
    const [c, r] = k.split(',').map(Number)
    const f = g.floorAt(c, r)
    if (!f) return 'NO FLOOR'
    const a = `${f.col},${f.row}`
    if (drawn.has(a)) return `drawn@${a}`
    if (cull.visible.includes(a)) return `visible-not-drawn@${a}`
    if (cull.onscreen.includes(a)) return `range-culled@${a}`
    if (cull.rect.includes(a)) return `screen-culled@${a}`
    if (cull.all.includes(a)) return `window-culled@${a}`
    return `NOT IN ASSETS@${a}`
  }
  const top = [...hits].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => {
    const [c, r] = k.split(',').map(Number)
    const f = g.floorAt(c, r)
    const stack = (g.assets || []).filter(a => a.col === c && a.row === r)
    return { cell: k, px: v, floor: f?.tileKey ?? null, h: g.getHeight(c, r), n: stack.length, fate: fate(k),
      keys: stack.map(a => `${a.tileKey}@${a.heightLevel}${a.depth > 1 ? `d${a.depth}${a.depthDir}` : ''}`).join(' ') }
  })
  const runInfo = {}
  for (const a of (g.assets||[])) {
    const k = a.tileKey ?? 'undefined'
    if (runInfo[k]) continue
    runInfo[k] = JSON.parse(JSON.stringify(a))
  }
  // THE INVARIANT: every cell floorAt() answers for must be answered by an asset that is STILL in the list.
  const live = new Set(g.assets)
  const orphan = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const f = g.floorAt(c, r)
    if (f && !live.has(f)) orphan.push(`${c},${r}:${f.tileKey}@${f.col},${f.row}`)
  }
  // and every hole cell, is it orphaned?
  const holeOrphan = [...hits.keys()].filter(k => { const [c, r] = k.split(',').map(Number); const f = g.floorAt(c, r); return f && !live.has(f) }).length
  return { holes, unclaimed, top, cells: hits.size, runInfo, orphan: orphan.length, orphanSample: orphan.slice(0, 12), holeOrphan }
})
console.log(`${PRESET} | ${RIVER} | seed ${SEED}: ${out.holes} hole px over ${out.cells} cells, ${out.unclaimed} off any cell`)
for (const t of out.top) console.log(`  ${t.cell.padEnd(7)} ${String(t.px).padStart(5)}px  h=${t.h} floor=${String(t.floor).padEnd(12)} ${t.fate.padEnd(26)} [${t.n}] ${t.keys}`)
console.log(`\nORPHANED floor cells (floorAt answers with an asset no longer in the list): ${out.orphan}`)
console.log('  sample:', out.orphanSample.join('  '))
console.log(`  hole cells that are orphaned: ${out.holeOrphan} of ${out.cells}`)
console.log('\n--- tile settings by label ---')
for (const [k,v] of Object.entries(out.runInfo)) console.log(' ', k, JSON.stringify(v))
await b.close()
