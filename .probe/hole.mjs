import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: new RegExp('^' + (process.env.PRESET || 'Meadow')) }).first().click()
await p.waitForTimeout(400)
for (const [label, value] of Object.entries(JSON.parse(process.env.OPTS || '{}'))) {
  await p.evaluate(([label, value]) => {
    for (const s of document.querySelectorAll('select')) {
      const text = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '')
      if (!text.trim().startsWith(label)) continue
      const opt = [...s.options].find(o => o.text === value || o.text.startsWith(value) || o.value === value)
      if (opt) { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, opt.value); s.dispatchEvent(new Event('change', { bubbles: true })) }
    }
  }, [label, value])
  await p.waitForTimeout(200)
}
if (process.env.SEED) await p.evaluate(seed => { let t = Number(seed) >>> 0; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } }, process.env.SEED)
await p.getByRole('button', { name: /Build this world/i }).first().click()
await p.waitForTimeout(4000)
const zoomSteps = Number(process.env.ZOOM || 0)
if (zoomSteps > 0) {
  const cv = await p.$('canvas')
  const box = await cv.boundingBox()
  for (let i = 0; i < zoomSteps; i++) { await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.wheel(0, -240); await p.waitForTimeout(120) }
  await p.waitForTimeout(900)
}
console.log(await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  let dug = 0, missingSide = 0, noNeighbour = 0
  const sample = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const here = g.getHeight(c, r)
    if (here >= 0) continue
    dug++
    for (const [dc, dr] of [[-1, 0], [0, -1]]) {
      const nc = c + dc, nr = r + dr
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) { noNeighbour++; continue }
      if (g.getHeight(nc, nr) - here <= 0) continue
      const side = g.floorAt(nc, nr)?.sideColor
      if (!side) { missingSide++; if (sample.length < 6) sample.push({ at: `${nc},${nr}`, tile: g.floorAt(nc, nr)?.tileKey, color: g.floorAt(nc, nr)?.color }) }
    }
  }
  // HOLES = clear-colour pixels the background cannot reach. Flood the clear colour in from the canvas
  // border; whatever is still clear afterwards is a gap INSIDE the drawn map.
  const cv0 = document.querySelector('canvas')
  const c2 = cv0.getContext('2d')
  const W = cv0.width, H = cv0.height
  const px = c2.getImageData(0, 0, W, H).data
  const isClear = i => px[i] === 0x1a && px[i + 1] === 0x1a && px[i + 2] === 0x2e
  const seen = new Uint8Array(W * H)
  const stack = []
  for (let x = 0; x < W; x++) { stack.push(x, 0, x, H - 1) }
  for (let y = 0; y < H; y++) { stack.push(0, y, W - 1, y) }
  while (stack.length) {
    const y = stack.pop(), x = stack.pop()
    if (x < 0 || y < 0 || x >= W || y >= H) continue
    const n = y * W + x
    if (seen[n] || !isClear(n * 4)) continue
    seen[n] = 1
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1)
  }
  let inside = 0
  let minX = W, minY = H, maxX = 0, maxY = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = y * W + x
    if (seen[n] || !isClear(n * 4)) continue
    inside++
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  return JSON.stringify({ dug, holePixels: inside, box: inside ? [minX, minY, maxX, maxY] : null })
}))
await b.close()
