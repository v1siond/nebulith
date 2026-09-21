import { chromium } from 'playwright'
import { BASE } from './base.mjs'
const LABEL = process.argv[2] ?? 'Woodland city', CATEGORY = process.argv[3] ?? 'city'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } })
await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
if (CATEGORY !== 'wilderness') { await page.selectOption('select', CATEGORY).catch(() => {}); await page.waitForTimeout(500) }
await page.getByRole('button', { name: new RegExp('^' + LABEL) }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Build this world/ }).click()
await page.waitForTimeout(5000)
console.log(JSON.stringify(await page.evaluate(() => window.__isoCull), null, 1))
await b.close()
