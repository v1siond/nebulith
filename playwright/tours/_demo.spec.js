// DEMO VIDEO of the real running game (:3000): emoji, generate a village (peaked-roof houses seated on the
// ground), center a house, click a wall block (selector lands on it), pan across the town. Recorded to video.
const { test } = require('@playwright/test')
const wait = (p, ms) => p.waitForTimeout(ms)

test.use({ viewport: { width: 1440, height: 900 }, video: { mode: 'on', size: { width: 1440, height: 900 } } })

test('nebulith demo', async ({ page }) => {
  page.on('pageerror', e => console.log('PAGEERROR:', e.message))
  await page.goto('/templates?new=1')
  await wait(page, 4000)
  await page.evaluate(() => window.__setArtStyle && window.__setArtStyle('emoji'))
  await wait(page, 1000)

  await page.evaluate(() => window.__genVillage && window.__genVillage())
  await wait(page, 3000) // linger on the generated village
  const buildings = await page.evaluate(() => (window.__buildings ? window.__buildings() : []))
  const b = buildings.find(x => x.type === 'house') || buildings[0]

  await page.evaluate(c => window.__centerOn && window.__centerOn(c.col, c.row), { col: b.col, row: b.row })
  await wait(page, 2000) // one house, close

  // click a front wall block just above the door → selector should hug it
  const scr = await page.evaluate(({ col, row }) => (window.__isoBlockScreen ? window.__isoBlockScreen(col, row, 1) : null), b.door)
  if (scr) { await page.mouse.move(scr.x, scr.y); await wait(page, 400); await page.mouse.click(scr.x, scr.y); await wait(page, 2500) }

  // pan across the town (plain drag pans)
  await page.mouse.move(720, 500); await page.mouse.down();
  for (let i = 0; i < 20; i++) { await page.mouse.move(720 - i * 12, 500 - i * 4); await wait(page, 40) }
  await page.mouse.up(); await wait(page, 2000)
})
