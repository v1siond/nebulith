// AUTONOMOUS visual check of the peaked/box roofs on the real game (:3000), EMOJI. Generate a town, screenshot
// the whole thing, then center a house (always peaked) and screenshot it close. I read the pixels myself.
const { test } = require('@playwright/test')
const DIR = '/home/visiond/.claude/jobs/fce8d7fd/tmp'
const wait = (p, ms) => p.waitForTimeout(ms)

test.use({ viewport: { width: 1440, height: 900 } })

test('nebulith roofs', async ({ page }) => {
  page.on('console', m => console.log('PAGE:', m.text()))
  page.on('pageerror', e => console.log('PAGEERROR:', e.message))
  await page.goto('/templates?new=1')
  await wait(page, 4000)
  await page.evaluate(() => window.__setArtStyle && window.__setArtStyle('emoji'))
  await wait(page, 800)
  await page.evaluate(() => window.__genVillage && window.__genVillage())
  await wait(page, 2200)
  const buildings = await page.evaluate(() => (window.__buildings ? window.__buildings() : []))
  console.log('TYPES:', JSON.stringify((buildings || []).map(b => b.type)))
  await page.screenshot({ path: `${DIR}/roof-town.png` })

  const b = buildings.find(x => x.type === 'house') || buildings.find(x => x.type === 'big-house') || buildings[0]
  console.log('CENTER ON:', JSON.stringify(b))
  await page.evaluate(c => window.__centerOn && window.__centerOn(c.col, c.row), { col: b.col, row: b.row })
  await wait(page, 1100)
  await page.screenshot({ path: `${DIR}/roof-house.png` })
})
