/**
 * THE FRAME RATE, measured the way a person would feel it.
 *
 *     node e2e/perf.mjs "Woodland city" city 100 60
 *
 * Builds a world through the UI, zooms all the way out so the whole map is on screen, then walks with WASD
 * and counts frames. Three things this harness insists on, each because measuring without it produced a
 * confident wrong answer:
 *
 * WARM UP FIRST. The sprite caches are cold on the first frames and the JIT has not settled, so the opening
 * seconds read several fps low. Six seconds of walking are thrown away before anything is counted.
 *
 * SAMPLE MORE THAN ONCE. Back-to-back runs of the SAME build differed by 6 fps here, which is wider than
 * most changes worth making, so a single number cannot tell an improvement from noise.
 *
 * REBUILD THE BUNDLE. The engine's own esbuild watcher dies silently and leaves a stale `game.js` behind,
 * which reads as "the change did nothing" for every change. Run `mix esbuild game` before this.
 */
import { chromium } from 'playwright'
const LABEL = process.argv[2] ?? 'Woodland city'
const CATEGORY = process.argv[3] ?? 'city'
const COLS = Number(process.argv[4] ?? 100)
const ROWS = Number(process.argv[5] ?? 60)
const SAMPLES = Number(process.argv[6] ?? 3)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.addInitScript(() => {
  const w = window
  w.__frames = 0
  w.__di = 0
  const raf = w.requestAnimationFrame.bind(w)
  w.requestAnimationFrame = cb => raf(t => { w.__frames++; return cb(t) })
  const orig = CanvasRenderingContext2D.prototype.drawImage
  CanvasRenderingContext2D.prototype.drawImage = function (...a) {
    if (this.canvas && String(this.canvas.className).includes('nebcanvas')) w.__di++
    return orig.apply(this, a)
  }
})
await page.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const setField = async (aria, value) => {
  const f = page.getByLabel(aria, { exact: false }).first()
  if (await f.count() === 0) return
  await f.fill(String(value))
  await f.press('Enter').catch(() => {})
}
await setField('Map columns', COLS)
await setField('Map rows', ROWS)
await page.waitForTimeout(600)
if (CATEGORY !== 'wilderness') { await page.selectOption('select', CATEGORY).catch(() => {}); await page.waitForTimeout(500) }
await page.getByRole('button', { name: new RegExp('^' + LABEL) }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Build this world/ }).click()
await page.waitForTimeout(9000)
// Maximum zoom OUT. The wheel handler is bound to the canvas with {passive:false}, so the event is
// dispatched on the element: a synthesised pointer wheel does not land on it.
await page.evaluate(() => {
  const c = document.querySelector('canvas.nebcanvas') ?? document.querySelector('canvas')
  if (c) for (let i = 0; i < 12; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(900)
// PROVE the zoom actually landed on the clamp. Inferring it from halfSpan once said 0.64 when the harness
// believed it was at 0.5, which would have measured a third of the map instead of the whole thing.
const shot = await page.evaluate(() => {
  const pr = window.__nebulithProject
  return { zoom: document.body.innerText.match(/(\d+)%/)?.[1], tileW: pr?.tileW, tileH: pr?.tileH, cull: window.__isoCull }
})
console.log(`${COLS}x${ROWS} ${LABEL}  zoom=${shot.zoom}%  tileW=${shot.tileW} tileH=${shot.tileH}  cull=${JSON.stringify(shot.cull)}`)

await page.keyboard.down('w'); await page.keyboard.down('d')
await page.waitForTimeout(6000) // warm-up, thrown away
const fps = []
for (let i = 0; i < SAMPLES; i++) {
  await page.evaluate(() => { window.__frames = 0; window.__di = 0 })
  const t0 = Date.now()
  await page.waitForTimeout(4000)
  const el = (Date.now() - t0) / 1000
  const r = await page.evaluate(() => ({ f: window.__frames, di: window.__di }))
  fps.push(r.f / el)
  console.log(`  sample ${i + 1}  fps ${(r.f / el).toFixed(1).padStart(5)}   drawImage/frame ${(r.di / r.f).toFixed(0).padStart(5)}`)
}
await page.keyboard.up('w'); await page.keyboard.up('d')
const best = Math.max(...fps), median = fps.slice().sort((a, b) => a - b)[Math.floor(fps.length / 2)]
console.log(`\nmedian ${median.toFixed(1)} fps   best ${best.toFixed(1)} fps`)
await browser.close()
