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
if (process.env.SEED) await p.evaluate(seed => { let t = Number(seed) >>> 0; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } }, process.env.SEED)
await p.getByRole('button', { name: /Build this world/i }).first().click()
await p.waitForTimeout(4000)
const assets = await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const a = g.assets
  const list = Array.isArray(a) ? a : [...(a?.values?.() ?? [])].flat()
  const counts = {}
  for (const x of list) { const s = x.label || x.tileKey || x.slug || '?'; counts[s] = (counts[s] || 0) + 1 }
  const ground = {}
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const k = g.floorAt(c, r)?.tileKey || ''
    if (/bridge|plank|cobble/.test(k)) ground[k] = (ground[k] || 0) + 1
    if (/water|swamp/.test(k)) ground.WATER = (ground.WATER || 0) + 1
  }
  return JSON.stringify({ deckGround: ground, total: list.length,
    bridgey: Object.entries(counts).filter(([k]) => /bridge|rail|deck|plank|cobble/.test(k)),
    top: Object.entries(counts).sort((x,y)=>y[1]-x[1]).slice(0,10) })
})
console.log('ASSETS', assets)
const levels = await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const out = { water: {}, land: {} }
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const f = g.floorAt(c, r)
    if (!f) continue
    const k = f.tileKey || ''
    const lvl = f.heightLevel ?? 0
    const h = f.height ?? 0
    const top = (lvl + h).toFixed(2)
    const relief = g.getHeight(c, r)
    const bucket = /water|swamp/.test(k) ? out.water : out.land
    bucket[`relief${relief} lvl${lvl} h${h} top${(relief + lvl + h).toFixed(2)}`] = (bucket[`relief${relief} lvl${lvl} h${h} top${(relief + lvl + h).toFixed(2)}`] || 0) + 1
  }
  return JSON.stringify(out)
})
console.log('LEVELS', levels)
const heights = await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const rows = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const f = g.floorAt(c, r)
    const k = f?.tileKey || ''
    if (!/bridge|plank|cobble/.test(k)) continue
    // the deck cell and its four neighbours
    const around = [[1,0],[-1,0],[0,1],[0,-1]].map(([dc,dr]) => {
      const n = g.floorAt(c+dc, r+dr)
      return { k: n?.tileKey || '-', h: n?.height ?? 0 }
    })
    rows.push({ at: c + ',' + r, deckH: f.height ?? 0, wet: around.filter(a => /water/.test(a.k)).map(a => a.h) })
  }
  return JSON.stringify(rows.slice(0, 8))
})
console.log('HEIGHTS', heights)
const reach = await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const open = (c, r) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && !g.collision[r][c]
  let start = null
  for (let r = 0; r < g.rows && !start; r++) for (let c = 0; c < g.cols; c++) if (open(c, r)) { start = [c, r]; break }
  const seen = new Set([start.join(',')])
  const st = [start]
  while (st.length) {
    const [c, r] = st.pop()
    for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const k = (c+dc) + ',' + (r+dr)
      if (open(c+dc, r+dr) && !seen.has(k)) { seen.add(k); st.push([c+dc, r+dr]) }
    }
  }
  let walkable = 0
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) if (open(c, r)) walkable++
  // how many separate walkable islands the map has
  const all = new Set(), sizes = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    if (!open(c, r) || all.has(c + ',' + r)) continue
    const q = [[c, r]]; all.add(c + ',' + r); let n = 0
    while (q.length) { const [x, y] = q.pop(); n++
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) { const k = (x+dc)+','+(y+dr)
        if (open(x+dc, y+dr) && !all.has(k)) { all.add(k); q.push([x+dc, y+dr]) } } }
    sizes.push(n)
  }
  return JSON.stringify({ walkable, reachable: seen.size, islands: sizes.sort((a,b)=>b-a).slice(0,5) })
})
console.log('REACH', reach)
const art = await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const rows = []
  for (let r = 0; r < g.rows; r++) {
    let line = ''
    for (let c = 0; c < g.cols; c++) {
      const k = g.floorAt(c, r)?.tileKey || ''
      if (/bridge|plank|deck/.test(k)) line += 'B'
      else if (/water_deep/.test(k)) line += 'D'
      else if (/water_shallow/.test(k)) line += 's'
      else if (/water|swamp/.test(k)) line += 'w'
      else if (/trail|cobble|path|dirt|road/.test(k)) line += '.'
      else line += ' '
    }
    rows.push(String(r).padStart(2) + ' ' + line)
  }
  return rows.join('\n')
})
console.log(art)
await b.close()
