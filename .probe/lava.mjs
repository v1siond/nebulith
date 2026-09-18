import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
await p.getByRole('button', { name: new RegExp('^' + (process.env.PRESET || 'Volcanic')) }).first().click()
await p.waitForTimeout(700)
const swatch = async re => p.evaluate(r => {
  for (const b of document.querySelectorAll('.swatches button')) {
    if (new RegExp(r, 'i').test(b.textContent || '')) { b.click(); return b.textContent.trim() }
  }
  return null
}, re)
console.log('river:', await swatch('winds'))
await p.waitForTimeout(1500)
console.log('liquid:', await swatch(process.env.LIQUID || 'lava'))
await p.waitForTimeout(1500)
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3200)
console.log(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid, rows = g.groundSlugs()
  const byCell = new Map()
  for (const a of (g.assets || [])) if (a.type === 'floor') byCell.set(`${a.col},${a.row}`, a)
  const tally = {}
  let walkable = 0, cells = 0
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
    if (!/^water_/.test(rows[r][c])) continue
    cells++
    const col = byCell.get(`${c},${r}`)?.color
    tally[col ?? 'none'] = (tally[col ?? 'none'] ?? 0) + 1
    // A DECK over lava is meant to be walkable; what must never be walkable is the lava itself.
    const crossed = (globalThis.__nebulithStage?.decks?.has?.(`${c},${r}`)) || false
    if (!g.collision?.[r]?.[c] && !crossed) walkable++
  }
  const crowns = {}
  for (const a of (g.assets || [])) if (/^crown_/.test(a.label ?? '')) crowns[a.label] = (crowns[a.label] ?? 0) + 1
  const deckAssets = (g.assets || []).filter(a => /^bridge/.test(a.label ?? "")).length
  // WHAT the walkable ones actually are, named rather than guessed at.
  const detail = []
  for (let r = 0; r < rows.length && detail.length < 8; r++) for (let c = 0; c < rows[r].length && detail.length < 8; c++) {
    if (!/^water_/.test(rows[r][c]) || g.collision?.[r]?.[c]) continue
    const here = (g.assets || []).filter(a => a.col === c && a.row === r).map(a => a.label ?? a.type)
    detail.push(`${c},${r} ground=${rows[r][c]} assets=[${here.join('|')}]`)
  }
  return JSON.stringify({ liquidCells: cells, colours: tally, walkableLiquid: walkable, bridgeCells: deckAssets, detail, crowns })
}))
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(400)
const at = await p.evaluate(() => {
  const rows = globalThis.__nebulithGrid.groundSlugs()
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) if (/^water_/.test(rows[r][c])) { globalThis.__setHero?.(c, r + 6); return [c, r] }
  return null
})
await p.waitForTimeout(800)
const bx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(140) }
await p.waitForTimeout(700)
const png = await p.evaluate(() => [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0].toDataURL('image/png'))
writeFileSync(process.env.OUT || '/home/visiond/.claude/jobs/beedf1c6/tmp/lava.png', Buffer.from(png.split(',')[1], 'base64'))
console.log('saved', at)
await b.close()
