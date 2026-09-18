import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: /^Meadow/ }).first().click()
await p.waitForTimeout(400)
for (const [label, value] of Object.entries({Exits:'2',Pathways:'2',River:'Divides the map','Kind of crossing':'Wooden bridge'})) {
  await p.evaluate(([label, value]) => {
    for (const s of document.querySelectorAll('select')) {
      const text = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '')
      if (!text.trim().startsWith(label)) continue
      const opt = [...s.options].find(o => o.text === value || o.text.startsWith(value) || o.value === value)
      if (opt) { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, opt.value); s.dispatchEvent(new Event('change', { bubbles: true })) }
    }
  }, [label, value])
  await p.waitForTimeout(200)
}
await p.evaluate(() => { let t = 5; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/i }).first().click()
await p.waitForTimeout(4000)
console.log(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  let wet = 0, wetBlocked = 0, rim = 0, rimBlocked = 0, wade = 0, wadeOpen = 0
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const k = g.floorAt(c, r)?.tileKey || ''
    const blocked = !!g.collision?.[r]?.[c]
    if (/water|swamp/.test(k)) {
      wet++
      if (blocked) wetBlocked++
      if (/shallow/.test(k)) { wade++; if (!blocked) wadeOpen++ }
      continue
    }
    // a RIM cell: dry land standing above a dug neighbour
    const here = g.getHeight(c, r)
    const drops = [[1,0],[-1,0],[0,1],[0,-1]].some(([dc,dr]) => {
      const nc = c+dc, nr = r+dr
      return nc>=0 && nr>=0 && nc<g.cols && nr<g.rows && g.getHeight(nc,nr) < here
    })
    if (!drops) continue
    rim++
    if (blocked) rimBlocked++
  }
  return JSON.stringify({ wet, wetBlocked, wade, wadeOpen, rim, rimBlocked })
}))
await b.close()
