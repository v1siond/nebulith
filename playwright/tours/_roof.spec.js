// Screenshot a generated HOUSE in all 3 views after the roof-from-tiles change, so the peaked roof (now
// per-cell stacked tiles, no cap drawer) can be judged: 2D = triangle, iso = 3D gable, top = footprint rect.
const { test } = require('@playwright/test')
const wait = (p, ms) => p.waitForTimeout(ms)
const DIR = '/tmp/claude-1000/-home-visiond-projects-game-engine-game-website/0aa29170-7ffc-40ce-ab66-086dddabf2bb/scratchpad'

test.use({ viewport: { width: 1200, height: 860 } })

test('roof from tiles — house in 3 views', async ({ page }) => {
  page.on('pageerror', e => console.log('PAGEERROR:', e.message))
  await page.goto('/templates?new=1')
  await wait(page, 4000)
  await page.evaluate(() => window.__setArtStyle && window.__setArtStyle('emoji'))
  await wait(page, 700)
  let bs = []
  for (let i = 0; i < 6 && !bs.some(b => b.type === 'house'); i++) {
    await page.evaluate(() => window.__genVillage())
    await wait(page, 1200)
    bs = await page.evaluate(() => (window.__buildings ? window.__buildings() : []))
  }
  const b = bs.find(x => x.type === 'house') || bs[0]
  console.log('HOUSE', JSON.stringify(b))
  const center = async () => { await page.evaluate(([c, r]) => window.__centerOn(c, r), [b.col, b.row]); await wait(page, 500) }

  await center(); await page.screenshot({ path: DIR + '/roof-iso.png' })
  await page.evaluate(() => window.__setView && window.__setView('2d')); await center(); await page.screenshot({ path: DIR + '/roof-2d.png' })
  await page.evaluate(() => window.__setView && window.__setView('top')); await center(); await page.screenshot({ path: DIR + '/roof-top.png' })
  console.log('SHOTS_DONE')
})
