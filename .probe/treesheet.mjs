// EVERY TREE KIND as the editor's own object palette draws it: the same preview path the map uses.
// The framework's "validate visually" step made mechanical, so "the trees are fixed" can mean ALL of them.
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
const opened = await p.evaluate(() => {
  for (const el of document.querySelectorAll('button')) {
    if (/Objects\s*\d*/.test((el.textContent || '').trim())) { el.click(); return el.textContent.trim() }
  }
  return false
})
console.log('objects panel:', opened)
await p.waitForTimeout(2500)
// Scroll every tree swatch into view so the lazy thumbnails actually render.
const found = await p.evaluate(async () => {
  const sws = [...document.querySelectorAll('.sw')].filter(s => /tree|bush/i.test(s.textContent || ''))
  for (const s of sws) { s.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 40)) }
  return sws.map(s => (s.textContent || '').trim().slice(0, 28))
})
console.log('tree swatches:', found.length)
console.log(found.join(' | '))
await p.waitForTimeout(3000)
// Crop to the palette column.
const box = await p.evaluate(() => {
  const s = document.querySelector('.sw')
  if (!s) return null
  let n = s.parentElement
  while (n && n.scrollHeight < 300) n = n.parentElement
  const r = (n || s).getBoundingClientRect()
  return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, 420), height: Math.min(r.height, 950) }
})
await p.screenshot({ path: '/home/visiond/.claude/jobs/beedf1c6/tmp/treesheet.png', clip: box ?? undefined })
console.log('saved')
await b.close()
