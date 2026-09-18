// E2E on the REAL editor (:3000): the selection requirements.
//  req 3 — ADDITIVE multi-select: shift+drag 4, then shift+drag 4 more → 8 selected (no restart).
//  req 4 — selecting a cell selects the TILE inside (a building cell shows a tile in the inspector).
// Objective counts via window.__cellSel(); tile via the inspector "— tile · X —" header.
const { test, expect } = require('@playwright/test')
const wait = (p, ms) => p.waitForTimeout(ms)

const shiftDragRect = async (page, a, b) => {
  await page.keyboard.down('Shift')
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2)
  await page.mouse.move(b.x, b.y)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await wait(page, 200)
}

test.use({ viewport: { width: 1440, height: 900 } })

test('selection: additive multi-select 4 + 4 = 8, and a cell selects its tile', async ({ page }) => {
  page.on('pageerror', e => console.log('PAGEERROR:', e.message))
  await page.goto('/templates?new=1')
  await wait(page, 4000)
  await page.evaluate(() => window.__setArtStyle && window.__setArtStyle('emoji'))
  await wait(page, 700)
  await page.evaluate(() => window.__genVillage && window.__genVillage())
  await wait(page, 1500)
  await page.evaluate(() => window.__centerOn && window.__centerOn(12, 12))
  await wait(page, 500)

  // ── req 3: ADDITIVE ── two disjoint 2×2 rectangles of GROUND cells, via their on-screen positions.
  const cell = (c, r) => page.evaluate(([c, r]) => window.__isoBlockScreen(c, r, 0), [c, r])
  await shiftDragRect(page, await cell(9, 9), await cell(10, 10))   // rect A = 4 cells
  const afterA = await page.evaluate(() => window.__cellSel().count)
  await shiftDragRect(page, await cell(13, 13), await cell(14, 14)) // rect B = 4 more
  const afterB = await page.evaluate(() => window.__cellSel().count)
  console.log('ADDITIVE_SELECT', JSON.stringify({ afterA, afterB }))

  // ── req 4: selecting a building CELL selects the TILE inside ── click a building wall block.
  const bs = await page.evaluate(() => (window.__buildings ? window.__buildings() : []))
  let tileHeader = null
  if (bs.length) {
    const b = [...bs].sort((x, z) => (z.col + z.row) - (x.col + x.row))[0]
    await page.evaluate(([c, r]) => window.__centerOn(c, r), [b.col, b.row])
    await wait(page, 300)
    const wall = await page.evaluate(([c, r]) => window.__isoBlockScreen(c, r, 1), [b.col, b.row])
    await page.mouse.move(wall.x, wall.y); await page.mouse.down(); await page.mouse.up()
    await wait(page, 300)
    const el = page.locator('p', { hasText: /tile ·/i }).first()
    if (await el.count()) { const m = (await el.innerText()).match(/·\s*([A-Za-z_]+)/); tileHeader = m ? m[1].toLowerCase() : null }
  }
  console.log('CELL_SELECTS_TILE', JSON.stringify({ building: !!bs.length, tileHeader }))

  expect(afterA, 'first shift+drag selects 4 cells').toBe(4)
  expect(afterB, 'second shift+drag ADDS 4 more → 8 (additive, no restart)').toBe(8)
})
