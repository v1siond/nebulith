import { chromium } from 'playwright'
import { BASE } from './base.mjs'
import { logIn } from './logIn.mjs'
import { openScratchMap, dropScratchMap } from './scratchMap.mjs'

const LABEL = process.argv[2] ?? 'Woodland'
const CATEGORY = process.argv[3] ?? 'wilderness'
const SECONDS = Number(process.argv[4] ?? 6)
const COLS = Number(process.argv[5] ?? 100)
const ROWS = Number(process.argv[6] ?? 60)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

// COUNT THE APP'S OWN FRAMES. The loop is one rAF chain, so counting rAF callbacks counts its frames.
await page.addInitScript(() => {
  const w = window
  w.__frames = 0
  const raf = w.requestAnimationFrame.bind(w)
  w.requestAnimationFrame = (cb) => raf((t) => { w.__frames++; return cb(t) })
})

const errors = []
page.on('pageerror', e => errors.push(e.message.slice(0, 120)))

// ITS OWN MAP. Bare /templates shows the GALLERY once the database holds a map, and the gallery has no
// generator button, so a harness that assumes the editor measures nothing and times out instead.
await logIn(page, BASE)
const scratchId = await openScratchMap(page, BASE, { cols: COLS, rows: ROWS, name: 'e2e fps' })
await page.waitForTimeout(1500)

// CLICK THROUGH IT, the way a person does.
if (CATEGORY !== 'wilderness') {
  await page.selectOption('select', CATEGORY).catch(() => {})
  await page.waitForTimeout(600)
}
await page.getByRole('button', { name: new RegExp('^' + LABEL) }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Build this world/ }).click()
await page.waitForTimeout(6000) // generation

// PROVE THERE IS A MAP BEFORE MEASURING ONE.
//
// A frame rate is only a number about a scene. This harness reported 120 fps at 0.37ms a frame once,
// and 0.37ms cannot draw five thousand tiles: the run had not built a world, and an empty canvas
// redraws very fast. A measurement that cannot tell "fast" from "nothing there" is worse than no
// measurement, because it gets quoted.
const built = await page.evaluate(() => window.__nebulithGrid?.assets?.length ?? 0)
if (built < 500) {
  throw new Error(`refusing to measure an empty scene: the grid holds ${built} tiles, so the world never built`)
}
console.log(`scene: ${built} tiles\n`)

const sample = async (tag, keys) => {
  await page.evaluate(() => { window.__frames = 0; window.__iso = [] })
  // Sample the render cost each frame while the keys are held.
  await page.evaluate(() => {
    const w = window
    w.__isoTimer = setInterval(() => { if (typeof w.__isoRenderMs === 'number') w.__iso.push(w.__isoRenderMs) }, 50)
  })
  for (const k of keys) await page.keyboard.down(k)
  const t0 = Date.now()
  await page.waitForTimeout(SECONDS * 1000)
  const elapsed = (Date.now() - t0) / 1000
  for (const k of keys) await page.keyboard.up(k)
  const out = await page.evaluate(() => {
    clearInterval(window.__isoTimer)
    const iso = window.__iso ?? []
    const avg = iso.length ? iso.reduce((a, b) => a + b, 0) / iso.length : null
    const sorted = [...iso].sort((a, b) => a - b)
    return { frames: window.__frames, isoAvgMs: avg, isoP95Ms: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : null, isoSamples: iso.length }
  })
  console.log(`${tag}  fps=${(out.frames / elapsed).toFixed(1)}  renderAvg=${out.isoAvgMs?.toFixed(2) ?? '-'}ms  renderP95=${out.isoP95Ms?.toFixed(2) ?? '-'}ms  (${out.isoSamples} samples)`)
  return out.frames / elapsed
}

// EDITOR MODE, which is what he says is slow, walking with WASD.
await sample(`editor  idle          ${CATEGORY}/${LABEL}`, [])
await sample(`editor  walking WASD  ${CATEGORY}/${LABEL}`, ['w', 'd'])

// AND IN PLAY MODE, for comparison.
await page.getByRole('button', { name: /Play/ }).first().click().catch(() => {})
await page.waitForTimeout(1500)
await sample(`play    walking WASD  ${CATEGORY}/${LABEL}`, ['w', 'd'])

if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 3))
await dropScratchMap(page, scratchId)
await browser.close()
