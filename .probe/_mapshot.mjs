import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'
const OUT = process.env.OUT || '/home/visiond/.claude/jobs/beedf1c6/tmp/water'
mkdirSync(OUT, { recursive: true })
const PRESET = process.env.PRESET || 'Swamp'
const REGION = process.env.REGION || 'open_water'
const RIVER = process.env.RIVER || 'none'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } })
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
await press(new RegExp('^' + PRESET)); await press(/^Water$/)
await press(RIVER === 'none' ? /^No river$/ : new RegExp('^' + RIVER, 'i'))
await choose('none'); await choose('2'); await choose('2'); await choose(REGION)
const before = await version()
await p.getByRole('button', { name: /Build this world/ }).click()
await settled(before)
// close the panels so the map is not covered, then frame the WHOLE grid
for (let i=0;i<6;i++){ const x=p.locator('button',{hasText:/^✕$/}).first(); if (await x.count().catch(()=>0)) { await x.click().catch(()=>{}); await p.waitForTimeout(150) } else break }
const cbx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(cbx.x + cbx.width/2, cbx.y + cbx.height/2)
for (let i=0;i<Number(process.env.OUTZOOM||5);i++){ await p.mouse.wheel(0, 240); await p.waitForTimeout(90) }
// centre on a SHORELINE cell so the boundary fills the frame
await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const slugs = g.groundSlugs()
  for (let r = 2; r < slugs.length - 2; r++) for (let c = 2; c < slugs[0].length - 2; c++) {
    if (!/water/.test(slugs[r][c] || '')) continue
    if ([[1,0],[0,1],[-1,0],[0,-1]].some(([dc,dr]) => { const s2 = slugs[r+dr]?.[c+dc] || ''; return s2 && !/water/.test(s2) })) {
      globalThis.__centerOn?.(c, r); return
    }
  }
})
await p.waitForTimeout(1200)
const png = await p.evaluate(() => [...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0].toDataURL('image/png'))
writeFileSync(`${OUT}/${PRESET}-${REGION}-map.png`, Buffer.from(png.split(',')[1],'base64'))
console.log('WROTE', `${OUT}/${PRESET}-${REGION}-map.png`)
await b.close()
