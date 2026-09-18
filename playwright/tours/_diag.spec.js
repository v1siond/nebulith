// Objective selector diagnostic: for a known wall column, print where each level draws (__isoBlockScreen),
// click level 2's pixel, print what got selected AND where THAT selected block draws. If they match, the
// pick+render agree (accurate). If not, the delta IS the residual offset — a number, not a guess.
const { test } = require('@playwright/test')
const wait = (p, ms) => p.waitForTimeout(ms)
test.use({ viewport: { width: 1440, height: 900 } })

test('selector diag', async ({ page }) => {
  page.on('pageerror', e => console.log('PAGEERROR:', e.message))
  await page.goto('/templates?new=1')
  await wait(page, 4000)
  await page.evaluate(() => window.__setArtStyle && window.__setArtStyle('emoji'))
  await wait(page, 700)
  await page.evaluate(() => window.__genVillage && window.__genVillage())
  await wait(page, 2000)
  const bs = await page.evaluate(() => (window.__buildings ? window.__buildings() : []))
  const b = bs.find(x => x.type === 'house') || bs[0]
  await page.evaluate(c => window.__centerOn && window.__centerOn(c.col, c.row), { col: b.col, row: b.row })
  await wait(page, 900)
  const w = b.wall
  const scans = await page.evaluate(({ col, row }) => {
    const out = {}
    for (let L = 0; L <= 3; L++) out[L] = window.__isoBlockScreen ? window.__isoBlockScreen(col, row, L) : null
    return out
  }, w)
  console.log('WALL', JSON.stringify(w), 'level→screen:', JSON.stringify(scans))
  const target = scans[2]
  if (target) {
    await page.mouse.click(target.x, target.y)
    await wait(page, 500)
    const sel = await page.evaluate(() => (window.__cellSel ? window.__cellSel() : null))
    const parts = (sel && sel.first ? sel.first.split(',').map(Number) : [])
    const back = parts.length >= 2 ? await page.evaluate(([c, r, l]) => window.__isoBlockScreen(c, r, l ?? 0), parts) : null
    console.log('CLICKED level-2 pixel', JSON.stringify(target), '→ SELECTED', JSON.stringify(sel), '→ that block draws at', JSON.stringify(back))
  }
})
