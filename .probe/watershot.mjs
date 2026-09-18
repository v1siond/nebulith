import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
const pick = async (label, value) => p.evaluate(([label, value]) => {
  for (const s of document.querySelectorAll('select')) {
    const t = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '')
    if (!t.trim().startsWith(label)) continue
    const o = [...s.options].find(x => x.text === value || x.text.startsWith(value) || x.value === value)
    if (!o) return false
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, o.value)
    s.dispatchEvent(new Event('change', { bubbles: true })); return true
  }
  return false
}, [label, value])
await p.getByRole('button', { name: new RegExp('^' + (process.env.PRESET || 'Woodland')) }).first().click()
await p.waitForTimeout(500)
await pick('River', process.env.RIVER || 'Winds through')
 await pick('Kind of water', process.env.WATERSET || 'Smooth water')
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3200)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(400)
// Stand the hero at the water so the camera is on it.
const at = await p.evaluate(want => {
  const g = globalThis.__nebulithGrid, rows = g.groundSlugs()
  if (want === 'rock') {
    const rocks = (g.assets || []).filter(a => (a.label ?? a.tileKey) === 'rock')
    if (!rocks.length) return { n: 0, note: 'no rock assets' }
    const mid = rocks[Math.floor(rocks.length / 2)]
    globalThis.__setHero?.(mid.col, mid.row + 5)
    return { col: mid.col, row: mid.row, n: rocks.length, settings: mid.settings }
  }
  const cells = []
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) if (/^water_/.test(rows[r][c])) cells.push([c, r])
  if (!cells.length) return null
  const mid = cells[Math.floor(cells.length / 2)]
  globalThis.__setHero?.(mid[0], mid[1] + 6)
  return { col: mid[0], row: mid[1], n: cells.length }
}, process.env.LOOKAT || 'water')
console.log('water cells:', at)
await p.waitForTimeout(800)
const bx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
for (let i = 0; i < Number(process.env.ZOOM || 3); i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(140) }
await p.waitForTimeout(700)
const png = await p.evaluate(() => {
  const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  return cv.toDataURL('image/png')
})
const { writeFileSync } = await import('fs')
writeFileSync(process.env.OUT || '/home/visiond/.claude/jobs/beedf1c6/tmp/watershot.png', Buffer.from(png.split(',')[1], 'base64'))
console.log('saved')
await b.close()
