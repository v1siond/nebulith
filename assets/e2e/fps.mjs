import { chromium } from 'playwright'
import { BASE } from './base.mjs'

const LABEL = process.argv[2] ?? 'Woodland'
const CATEGORY = process.argv[3] ?? 'wilderness'
const SECONDS = Number(process.argv[4] ?? 6)

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

await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

// CLICK THROUGH IT, the way a person does.
if (CATEGORY !== 'wilderness') {
  await page.selectOption('select', CATEGORY).catch(() => {})
  await page.waitForTimeout(600)
}
await page.getByRole('button', { name: new RegExp('^' + LABEL) }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Build this world/ }).click()
await page.waitForTimeout(6000) // generation

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
await browser.close()
