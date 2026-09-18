import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
console.log('all buttons:', await p.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent?.trim().slice(0,26)).filter(Boolean).join(' | ').slice(0, 900)))
const cat = await p.evaluate(() => {
  for (const el of document.querySelectorAll('button, [role="tab"], option, div[class*=card]')) {
    const s = (el.textContent || '').trim().toLowerCase()
    if (s.startsWith('town') || s.includes('town (')) { el.click(); return el.textContent.trim().slice(0,30) }
  }
  return false
})
console.log('town category:', cat)
await p.waitForTimeout(1600)
console.log('preset buttons now:', await p.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent?.trim().slice(0,22)).filter(s => s && !/FPS|ISO|Top|Flow|Rotate|Day|Clear|Overlays|Guides|Help|Art|Load|Saved|Play|More|Tools|Tiles|Objects|Characters|Rules|Player|New world|Build|Apply|⤢|✕|↶|↷/.test(s)).join(' | ').slice(0,500)))
console.log('preset picked:', await p.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (/town/i.test((b.textContent || '').trim())) { b.click(); return b.textContent.trim().slice(0,30) }
  }
  return false
}))
await p.waitForTimeout(1600)
// River and crossing are swatch strips now.
const pickSwatch = async re => p.evaluate(r => {
  for (const b of document.querySelectorAll('.swatches button')) {
    if (new RegExp(r, 'i').test(b.textContent || '')) { b.click(); return b.textContent.trim() }
  }
  return null
}, re)
console.log('river:', await pickSwatch('winds'))
await p.waitForTimeout(1600)
console.log('crossing:', await pickSwatch('wooden'))
await p.waitForTimeout(900)
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3500)
console.log(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const by = {}
  for (const a of (g.assets || [])) {
    const l = a.label ?? ''
    if (/^bridge/.test(l)) by[l] = (by[l] ?? 0) + 1
  }
  return 'BRIDGE CELLS: ' + JSON.stringify(by)
}))
await b.close()
