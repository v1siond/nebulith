/**
 * WHERE THE BIG FRAME GOES. bigmap's worst case (a large map at maximum zoom out, walked with WASD) under
 * the CPU profiler, so the next optimisation is aimed at what the samples say rather than at what reads
 * expensive in the source.
 *
 *     bin/e2e bigprofile "Woodland city" city 100 60 6
 *
 * It also reports `__isoRenderMs`, which splits "the renderer is slow" from "something else in the frame is
 * slow". A 40ms frame with a 12ms render is not a rendering problem.
 */
import { chromium } from 'playwright'
import { BASE } from './base.mjs'
import { logIn } from './logIn.mjs'
import { openScratchMap, dropScratchMap } from './scratchMap.mjs'
const LABEL = process.argv[2] ?? 'Woodland city'
const CATEGORY = process.argv[3] ?? 'city'
const COLS = Number(process.argv[4] ?? 100)
const ROWS = Number(process.argv[5] ?? 60)
const SECONDS = Number(process.argv[6] ?? 6)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.addInitScript(() => {
  const w = window
  w.__frames = 0
  const raf = w.requestAnimationFrame.bind(w)
  w.requestAnimationFrame = cb => raf(t => { w.__frames++; return cb(t) })
})
await logIn(page, BASE)
const scratchId = await openScratchMap(page, BASE, { cols: 100, rows: 60, name: 'e2e probe' })
await page.waitForTimeout(2500)

const setField = async (aria, value) => {
  const f = page.getByLabel(aria, { exact: false }).first()
  if (await f.count() === 0) return false
  await f.fill(String(value))
  await f.press('Enter').catch(() => {})
  return true
}
await setField('Map columns', COLS)
await setField('Map rows', ROWS)
await page.waitForTimeout(600)

if (CATEGORY !== 'wilderness') { await page.selectOption('select', CATEGORY).catch(() => {}); await page.waitForTimeout(500) }
await page.getByRole('button', { name: new RegExp('^' + LABEL) }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Build this world/ }).click()
await page.waitForTimeout(9000)

await page.evaluate(() => {
  const c = document.querySelector('canvas.nebcanvas') ?? document.querySelector('canvas')
  if (!c) return
  for (let i = 0; i < 12; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(900)
console.log(`map ${COLS}x${ROWS}  cull=${JSON.stringify(await page.evaluate(() => window.__isoCull))}`)

const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
await cdp.send('Profiler.start')
await page.evaluate(() => { window.__frames = 0 })
await page.keyboard.down('w'); await page.keyboard.down('d')
const t0 = Date.now()
await page.waitForTimeout(SECONDS * 1000)
const el = (Date.now() - t0) / 1000
await page.keyboard.up('w'); await page.keyboard.up('d')
const { profile } = await cdp.send('Profiler.stop')
const { frames, renderMs } = await page.evaluate(() => ({ frames: window.__frames, renderMs: window.__isoRenderMs }))
console.log(`fps ${(frames / el).toFixed(1)}   isoRenderMs ${renderMs ?? 'n/a'}   frameBudget ${(1000 * el / frames).toFixed(1)}ms`)

const self = new Map()
for (const n of profile.nodes) {
  if (!n.hitCount) continue
  const f = n.callFrame
  const name = `${f.functionName || '(anonymous)'}  ${String(f.url).split('/').pop()}:${f.lineNumber + 1}`
  self.set(name, (self.get(name) ?? 0) + n.hitCount)
}
const total = [...self.values()].reduce((a, b) => a + b, 0)
console.log(`\nself time, top 25 of ${total} samples:`)
for (const [name, hits] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`  ${(100 * hits / total).toFixed(1).padStart(5)}%  ${name}`)
}
await dropScratchMap(page, scratchId)
await browser.close()
