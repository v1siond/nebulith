import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
let pass = 0, total = 0
const run = async (cat, preset, label) => {
  await p.evaluate(c => { for (const s of document.querySelectorAll('select')) { const h=[...s.options].find(o=>new RegExp('^'+c,'i').test(o.text)); if(h){Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set.call(s,h.value); s.dispatchEvent(new Event('change',{bubbles:true})); return} } }, cat)
  await p.waitForTimeout(500)
  if (!await p.getByRole('button', { name: new RegExp('^'+preset) }).first().click().then(()=>true).catch(()=>false)) return
  await p.waitForTimeout(300)
  // Warm-up build discarded: the first click after choosing a preset generates twice (preview + build).
  await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(3900)
  let plant = 0, forest = 0, labels = {}
  for (let i = 0; i < 2; i++) {
    await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(3900)
    const r = await p.evaluate(() => {
      const ex = globalThis.__exits?.() || []
      const a = globalThis.__nebulithGrid?.assets || []
      const PL = /^(trunk_|leaf_|canopy|cactus_|bush)/
      const byCell = {}
      for (const x of a) if (PL.test(x.label || '')) (byCell[x.col + ',' + x.row] ||= []).push(x.label)
      const hits = []
      for (const e of ex) for (const q of e.cells) { const k = q.col + ',' + q.row; if (byCell[k]) hits.push(...byCell[k]) }
      return { hits, forest: a.filter(x => /^trunk_/.test(x.label||'')).length }
    })
    plant += r.hits.length; forest += r.forest
    for (const l of r.hits) labels[l] = (labels[l] || 0) + 1
  }
  const ok = plant === 0 && forest > 0
  total++; if (ok) pass++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(20)} plantInExit=${plant} ${JSON.stringify(labels)} forest=${forest}`)
}
for (const [c, g, n] of [['Wilderness','Woodland','Woodland'],['Wilderness','Jungle','Jungle'],['Wilderness','Desert','Desert'],['Wilderness','Beach','Beach'],['Wilderness','Mountain','Mountain'],['Wilderness','Swamp','Swamp'],['Wilderness','Ruins','Ruins'],['City','Woodland','Woodland city'],['City','Meadow','Meadow city'],['Town','Woodland','Woodland town'],['Village','Desert','Desert village']]) await run(c, g, n)
console.log(`\n${pass}/${total} clean`)
await b.close()
