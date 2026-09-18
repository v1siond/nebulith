import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
for (const [cat, preset] of [['Wilderness','Desert'],['City','Desert'],['Wilderness','Beach']]) {
  await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
  await p.waitForTimeout(3000)
  await p.evaluate(c => { for (const s of document.querySelectorAll('select')) { const h=[...s.options].find(o=>new RegExp('^'+c,'i').test(o.text)); if(h){Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set.call(s,h.value); s.dispatchEvent(new Event('change',{bubbles:true})); return} } }, cat)
  await p.waitForTimeout(600)
  const ok = await p.getByRole('button', { name: new RegExp('^'+preset) }).first().click().then(()=>true).catch(()=>false)
  if (!ok) { console.log(cat, preset, 'NOT FOUND'); continue }
  await p.waitForTimeout(400)
  await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(3800)
  const rows = await p.evaluate(() => (globalThis.__tileTones?.(20) || []).filter(r => /^floor$/.test(r.label)))
  console.log(`${cat}/${preset}:`, JSON.stringify(rows.map(r => r.colors)))
}
await b.close()
