/** Find a canvas-clear pixel INSIDE the map and ask the editor which cell is under it. */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
const pick = async (label, value) => p.evaluate(([label, value]) => {
  for (const s of document.querySelectorAll('select')) {
    const text = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '')
    if (!text.trim().startsWith(label)) continue
    const opt = [...s.options].find(o => o.text === value || o.text.startsWith(value) || o.value === value)
    if (opt) { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, opt.value); s.dispatchEvent(new Event('change', { bubbles: true })); return true }
  }
  return false
}, [label, value])
await p.getByRole('button', { name: new RegExp('^' + (process.env.PRESET || 'Meadow')) }).first().click()
await p.waitForTimeout(300)
await pick('River', process.env.RIVER || 'Divides the map'); await pick('Exits', '2'); await pick('Pathways', '2')
if (process.env.DEPTH) await pick('How deep', process.env.DEPTH)
await p.evaluate(s => { let t = Number(s) >>> 0; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } }, Number(process.env.SEED || 5))
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3200)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(400)
const bx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
for (let i = 0; i < Number(process.env.ZOOM ?? 6); i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(110) }
await p.waitForTimeout(1000)

// A clear pixel whose neighbourhood is mostly DRAWN map (so it is a hole, not the background outside).
const spot = await p.evaluate(() => {
  const cv = document.querySelector('canvas')
  const { data, width, height } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
  const clear = (x, y) => { const i = (y * width + x) * 4; return data[i] === 0x1a && data[i+1] === 0x1a && data[i+2] === 0x2e }
  const R = 90
  for (let y = R; y < height - R; y += 3) for (let x = R; x < width - R; x += 3) {
    if (!clear(x, y)) continue
    let drawn = 0
    for (const [dx, dy] of [[-R,0],[R,0],[0,-R],[0,R]]) if (!clear(x + dx, y + dy)) drawn++
    if (drawn === 4) return { x, y, dpr: cv.width / cv.clientWidth }
  }
  return null
})
console.log('hole pixel:', JSON.stringify(spot))
console.log('playerViewRange:', await p.evaluate(() => window.__playerViewRange?.()))
await p.locator('canvas').first().screenshot({ path: '/home/visiond/.claude/jobs/beedf1c6/tmp/shots/hole.png' })
// Everything about the cells around that pixel: walk outward until a drawn pixel, then ask the grid.
if (spot) {
  const info = await p.evaluate(({ x, y }) => {
    const g = globalThis.__nebulithGrid
    const cv = document.querySelector('canvas')
    const { data, width } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
    const clear = (px, py) => { const i = (py * width + px) * 4; return data[i] === 0x1a && data[i+1] === 0x1a && data[i+2] === 0x2e }
    let up = 0
    while (up < 400 && clear(x, y - up)) up++
    let down = 0
    while (down < 400 && clear(x, y + down)) down++
    return { holeHeightPx: up + down, up, down, cols: g.cols, rows: g.rows }
  }, spot)
  console.log('hole shape:', JSON.stringify(info))
}
if (spot) {
  await p.mouse.move(bx.x + spot.x / spot.dpr, bx.y + spot.y / spot.dpr)
  await p.waitForTimeout(600)
  const txt = await p.evaluate(() => document.body.innerText.split('\n').filter(l => /Grid:|Pos:/.test(l)).slice(0, 3))
  console.log('readout:', JSON.stringify(txt))
}
await b.close()
