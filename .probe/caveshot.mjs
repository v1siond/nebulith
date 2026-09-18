import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
// A cave is a CATEGORY, not one of the wilderness presets, so the category has to be chosen first.
const cat = await p.evaluate(() => {
  for (const el of document.querySelectorAll('button, [role="tab"], option')) {
    if ((el.textContent || '').trim().toLowerCase().startsWith('cave')) { el.click(); return el.textContent.trim().slice(0, 30) }
  }
  for (const s of document.querySelectorAll('select')) {
    const o = [...s.options].find(x => /cave/i.test(x.text))
    if (o) { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); return 'select:' + o.text }
  }
  return null
})
console.log('cave category:', cat)
await p.waitForTimeout(700)
const btn = p.getByRole('button', { name: /^Cave/ }).first()
if (await btn.count()) { await btn.click(); await p.waitForTimeout(500) }
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3200)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(400)
const at = await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const rocks = (g.assets || []).filter(a => (a.label ?? a.tileKey) === 'rock')
  if (!rocks.length) return null
  const mid = rocks[Math.floor(rocks.length / 2)]
  globalThis.__setHero?.(mid.col, mid.row + 5)
  return { n: rocks.length, col: mid.col, row: mid.row }
})
console.log('rock assets:', at)
await p.waitForTimeout(800)
const bx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(140) }
await p.waitForTimeout(700)
const png = await p.evaluate(() => [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0].toDataURL('image/png'))
writeFileSync(process.env.OUT || '/home/visiond/.claude/jobs/beedf1c6/tmp/cave.png', Buffer.from(png.split(',')[1], 'base64'))
console.log('saved')
await b.close()
