import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
const press = async (rx) => { const t = p.getByRole('button', { name: rx }).first(); if (await t.count().catch(()=>0)) { await t.click().catch(()=>{}); await p.waitForTimeout(250); return true } return false }
const choose = (v) => p.evaluate(v => { for (const s of document.querySelectorAll('select')) { const o=[...s.options].find(x=>x.value===v); if(!o) continue; Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set.call(s,o.value); s.dispatchEvent(new Event('change',{bubbles:true})); return true } return false }, v)
const version = () => p.evaluate(() => globalThis.__nebulithGrid?.groundVersion ?? -1)
const settled = async (before) => {
  await p.locator('[role="status"]').first().waitFor({ state: 'visible', timeout: 8000 }).catch(()=>{})
  await p.locator('[role="status"]').first().waitFor({ state: 'detached', timeout: 60000 }).catch(()=>{})
  for (let i=0;i<80 && before!==undefined;i++){ if (await version()!==before) break; await p.waitForTimeout(300) }
  let last=-1, steady=0
  for (let i=0;i<60;i++){ const n=await version(); steady = n===last&&n>=0 ? steady+1 : 0; if (steady>=2) return; last=n; await p.waitForTimeout(400) }
}
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(2600); await settled()
await press(/^Swamp/); await press(/^Water$/); await press(/^No river$/)
await choose('none'); await choose('2'); await choose('2'); await choose('open_water')
const before = await version()
await p.getByRole('button', { name: /Build this world/ }).click()
await settled(before)
console.log(JSON.stringify(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  // THE DRAWN GEOMETRY: find a water cell whose orthogonal neighbour is land, and compare where each one's
  // top face lands on screen. Equal y means they are flush; a smaller y on the water means it stands proud.
  const slugs0 = g.groundSlugs()
  const pairs = []
  for (let r = 1; r < slugs0.length - 1 && pairs.length < 6; r++) {
    for (let c = 1; c < slugs0[0].length - 1 && pairs.length < 6; c++) {
      if (!/water/.test(slugs0[r][c] || '')) continue
      for (const [dc, dr] of [[1,0],[0,1],[-1,0],[0,-1]]) {
        const s2 = slugs0[r+dr]?.[c+dc] || ''
        if (!s2 || /water/.test(s2)) continue
        const a = globalThis.__cellScreen?.(c, r)
        const b2 = globalThis.__cellScreen?.(c+dc, r+dr)
        if (a && b2) pairs.push({ water: slugs0[r][c], land: s2, wy: Math.round(a.y), ly: Math.round(b2.y), dy: Math.round(a.y - b2.y) })
        break
      }
    }
  }
  globalThis.__PAIRS = pairs
  const slugs = g.groundSlugs()
  const out = { water: {}, land: {} }
  for (let r = 0; r < slugs.length; r++) for (let c = 0; c < slugs[0].length; c++) {
    const s = slugs[r][c] || ''
    const f = g.floorAt?.(c, r)
    const rec = /water/.test(s) ? out.water : out.land
    const k = `${s} h=${f?.height} lvl=${f?.heightLevel} gridH=${g.getHeight?.(c,r)}`
    rec[k] = (rec[k] || 0) + 1
  }
  const top = o => Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,4)
  return { water: top(out.water), land: top(out.land), pairs: globalThis.__PAIRS }
}), null, 1))
await b.close()
