// Image-analysis harness: generate a settlement, switch to a chosen VIEW, optionally turn on the
// collision/debug overlay, hide the editor UI, and screenshot the canvas.
// Run: BASE_URL=http://localhost:3001 SHOT=/abs/path.png VIEW=ISO|2D|Top DEBUG=1 DAYNIGHT=night \
//      ZONE=summer VARIANT=town npx playwright test playwright/tours/_isoshot.spec.js --project=chromium
import { test } from '@playwright/test'

const ZONE = process.env.ZONE || 'summer'
// 'village' was dropped (only town + city remain) — map any stale request to 'town'.
const VARIANT = (process.env.VARIANT || 'town') === 'village' ? 'town' : process.env.VARIANT || 'town'
const VIEW = process.env.VIEW || 'ISO' // ISO | 2D | Top
const DEBUG = process.env.DEBUG === '1'
const SHOT = process.env.SHOT || '/tmp/isoshot.png'

test('generate + screenshot a view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/templates?new=1')
  await page.locator('canvas').first().waitFor({ state: 'visible' })
  const btn = (name) => page.getByRole('button', { name, exact: true })
  await btn(ZONE).click().catch(() => {})
  await btn(VARIANT).click()
  await page.waitForTimeout(1000)
  if (process.env.SCATTER === '1') {
    await page.getByRole('button', { name: /Scatter entities/ }).click().catch(() => {})
    await page.waitForTimeout(500)
  }
  if (DEBUG) await page.getByRole('button', { name: /Debug overlay/ }).click().catch(() => {})
  // Toggle night before hiding the editor UI (the toggle lives in the DISPLAY sidebar).
  if (process.env.DAYNIGHT === 'night') await page.getByRole('button', { name: /Night mode/ }).click().catch(() => {})
  await btn(VIEW).click().catch(() => {}) // ISO / 2D / Top
  await page.waitForTimeout(600)
  if (process.env.NOHIDE !== '1') await page.getByRole('button', { name: /Preview/ }).click().catch(() => {}) // hide editor panels
  await page.waitForTimeout(1000)
  await page.locator('canvas').first().screenshot({ path: SHOT })
})
