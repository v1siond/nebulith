/** Shoot a REAL generated map at a REAL gate, so entrance placement is judged where it actually happens.
 *  The isolated object probe drops a composition at the map centre, where there is no pathway to be centred on. */
import { chromium } from 'playwright'
const PRESET = process.env.PRESET || 'Woodland'
const OUT = process.env.OUT || '/tmp/gateshots'
const NAME = process.env.NAME || 'gate'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(5000)
await p.getByRole('button', { name: new RegExp('^' + PRESET) }).first().click().catch(() => {})
await p.waitForTimeout(500)
await p.evaluate(() => { let t = 2024; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(5000)
for (let i = 0; i < 6; i++) { const x = p.locator('button', { hasText: /^✕$/ }).first(); if (await x.count().catch(() => 0)) { await x.click().catch(() => {}); await p.waitForTimeout(150) } else break }
await p.keyboard.press('Escape').catch(() => {})
const info = await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const open = []
  for (let c = 0; c < g.cols; c++) if (!g.isBlocked?.(c, g.rows - 1)) open.push(c)
  return { cols: g.cols, rows: g.rows, southOpen: open }
})
console.log('south border open cells:', JSON.stringify(info.southOpen))
const mid = info.southOpen.length ? info.southOpen[Math.floor(info.southOpen.length / 2)] : Math.floor(info.cols / 2)
const cbx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(cbx.x + cbx.width / 2, cbx.y + cbx.height / 2)
for (let i = 0; i < Number(process.env.ZOOM || 5); i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(90) }
await p.evaluate(([c, r]) => { globalThis.__setHero?.(c, r - 16); globalThis.__centerOn?.(c, r - 2) }, [mid, info.rows - 1])
await p.waitForTimeout(1500)
// crop around where the GATE actually projects, not a guessed slice of the canvas
const box = await p.evaluate(([c, r, S]) => {
  const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  const pr = globalThis.__nebulithProject
  const rect = cv.getBoundingClientRect()
  const sx = rect.width / cv.width, sy = rect.height / cv.height
  const at = pr.toScreen(c, r)
  return { x: rect.left + at.x * sx - S / 2, y: rect.top + at.y * sy - S * 0.72, width: S, height: S }
}, [mid, info.rows - 1, Number(process.env.SIZE || 760)])
const vp = p.viewportSize()
await p.screenshot({ path: `${OUT}/${NAME}.png`, clip: {
  x: Math.max(0, box.x), y: Math.max(0, box.y),
  width: Math.min(box.width, vp.width - Math.max(0, box.x)), height: Math.min(box.height, vp.height - Math.max(0, box.y)) } })
console.log('WROTE', `${OUT}/${NAME}.png`, 'centred on south gate col', mid)
await b.close()
