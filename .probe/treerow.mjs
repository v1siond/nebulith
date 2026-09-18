// PLACE ONE OF EVERY TREE KIND ON THE MAP, in a row, and photograph them.
//
// The palette thumbnails are 66px and too small to judge proportion by. This stamps each kind onto the real
// grid through the editor's own brush, so what is measured is exactly what a generated map draws.
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
// A bare map to plant on: meadow with nothing switched on.
await p.getByRole('button', { name: /^Meadow/ }).first().click(); await p.waitForTimeout(500)
await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(3000)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(400)
await p.evaluate(() => { for (const el of document.querySelectorAll('button')) if (/Objects\s*\d*/.test((el.textContent || '').trim())) { el.click(); return } })
await p.waitForTimeout(2000)
const kinds = (process.env.KINDS || 'Tree,Tree tall,Tree big,Tree small,Tree stub,Tree round,Tree column,Tree giant,Tree conifer,Tree cypress,Tree broadleaf,Tree gnarled,Tree palm,Tree coconut,Tree banana,Tree mangrove,Tree sapling,Bush,Bush round').split(',')
const canvas = await p.locator('canvas').first().boundingBox()
let placed = 0
for (const [i, kind] of kinds.entries()) {
  const armed = await p.evaluate(k => {
    for (const s of document.querySelectorAll('.sw')) {
      const label = (s.textContent || '').replace(/\d+×\d+$/, '').trim()
      if (label.toLowerCase() === k.toLowerCase()) { s.scrollIntoView({ block: 'center' }); s.click(); return true }
    }
    return false
  }, kind)
  if (!armed) { console.log('NOT FOUND:', kind); continue }
  await p.waitForTimeout(160)
  const col = 4 + (i % 10) * 3, row = 6 + Math.floor(i / 10) * 5
  const pt = await p.evaluate(({ col, row }) => { const s = globalThis.__nebulithProject.toScreen(col, row); return { x: s.x, y: s.y } }, { col, row })
  await p.mouse.click(canvas.x + pt.x, canvas.y + pt.y)
  await p.waitForTimeout(140)
  placed++
}
console.log('placed', placed, 'of', kinds.length)
await p.evaluate(() => { for (const el of document.querySelectorAll('button')) if (/«Tools/.test((el.textContent || '').trim())) { el.click(); return } })
await p.waitForTimeout(500)
// STAND WHERE THEY WERE PLANTED. The camera follows the hero and nothing else moves it, so a probe that
// plants at row 6 and photographs row 38 photographs an empty field.
const HC = Number(process.env.HERO_COL || 16), HR = Number(process.env.HERO_ROW || 14)
await p.evaluate(([c, r]) => globalThis.__setHero?.(c, r), [HC, HR])
await p.waitForTimeout(900)
const bx2 = await p.locator('canvas').first().boundingBox()
await p.mouse.move(bx2.x + bx2.width / 2, bx2.y + bx2.height / 2)
for (let i = 0; i < Number(process.env.ZOOM || 2); i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(140) }
await p.waitForTimeout(700)
const png = await p.evaluate(() => [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0].toDataURL('image/png'))
const { writeFileSync } = await import('fs')
writeFileSync('/home/visiond/.claude/jobs/beedf1c6/tmp/treerow.png', Buffer.from(png.split(',')[1], 'base64'))
console.log('saved')
await b.close()
