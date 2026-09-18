// WHICH SIDE OF ITS CELL A WATER BORDER IS DRAWN ON, at every camera facing.
//
// *"we also must ensure they stay consistent when rotating camera"*. Eyes cannot settle this: each build is a
// different random map, so two runs are never comparable. This asks the pixels instead, through the render's
// OWN cell-to-screen seam, so nothing here re-derives the projection.
//
// A `water_smooth_river_t` cell has land to its NORTH and water to its SOUTH, and its rim must be painted
// against the LAND. So sample two points inside the cell, one 44% of the way toward the land neighbour and one
// 44% toward the water neighbour (the rim band is the outer 12% of the tile), and ask which is brighter. The
// rim is near-white over mid blue, so the gap is large and unambiguous.
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
await p.getByRole('button', { name: new RegExp('^' + (process.env.PRESET || 'Woodland')) }).first().click()
await p.waitForTimeout(600)
await p.getByRole('button', { name: /^Water$/ }).first().click(); await p.waitForTimeout(400)
await p.getByRole('button', { name: /^Winds through/ }).first().click(); await p.waitForTimeout(400)
await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(3500)
for (const btn of await p.locator('button', { hasText: /^✕$/ }).all()) await btn.click().catch(() => {})
await p.waitForTimeout(600)

// The land side each single-sided piece must wear its rim against, in WORLD steps.
// WHICH WORLD DIRECTION each suffix's rim actually points at. Measured rather than assumed: the image is
// SHEARED onto the iso diamond, so "the top of the picture" is not obviously "the north of the grid".
const measure = async () => p.evaluate(() => {
  const DIRS = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }
  const rows = globalThis.__nebulithGrid.groundSlugs()
  const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  const off = document.createElement('canvas')
  off.width = canvas.width; off.height = canvas.height
  off.getContext('2d').drawImage(canvas, 0, 0)
  const px = off.getContext('2d').getImageData(0, 0, off.width, off.height).data
  const rect = canvas.getBoundingClientRect()
  const toCanvas = pt => ({ x: (pt.x - rect.left) * (canvas.width / rect.width), y: (pt.y - rect.top) * (canvas.height / rect.height) })
  // Average a 3x3 patch so one antialiased pixel cannot decide anything.
  const lum = pt => {
    let sum = 0, n = 0
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = Math.round(pt.x) + dx, y = Math.round(pt.y) + dy
      if (x < 0 || y < 0 || x >= off.width || y >= off.height) continue
      const i = (y * off.width + x) * 4
      if (px[i + 3] < 200) continue
      sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; n++
    }
    return n ? sum / n : null
  }
  const tally = {}
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const m = /^water_[a-z]+_[a-z]+_(t|b|l|r)$/.exec(rows[r][c] || '')
      if (!m) continue
      const here = globalThis.__cellScreen?.(c, r, 0)
      if (!here) continue
      let best = null, bestLum = -1, second = -1
      for (const [dir, [dc, dr]] of Object.entries(DIRS)) {
        const nb = globalThis.__cellScreen?.(c + dc, r + dr, 0)
        if (!nb) continue
        const v = lum(toCanvas({ x: here.x + (nb.x - here.x) * 0.44, y: here.y + (nb.y - here.y) * 0.44 }))
        if (v === null) continue
        if (v > bestLum) { second = bestLum; bestLum = v; best = dir } else if (v > second) second = v
      }
      if (!best || bestLum - second < 10) continue // no clear winner: something is standing over the cell
      tally[m[1]] = tally[m[1]] || {}
      tally[m[1]][best] = (tally[m[1]][best] || 0) + 1
    }
  }
  return tally
})

const bx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
for (let i = 0; i < 2; i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(140) }
await p.waitForTimeout(600)
for (const f of [0, 1, 2, 3]) {
  if (f > 0) { await p.locator('button', { hasText: /Rotate/ }).first().click(); await p.waitForTimeout(900) }
  const facing = await p.evaluate(() => globalThis.__cameraFacing?.())
  const tally = await measure()
  const say = Object.entries(tally).sort().map(([suf, d]) => {
    const top = Object.entries(d).sort((a, b) => b[1] - a[1])[0]
    return `_${suf}->${top[0]}(${top[1]}/${Object.values(d).reduce((a, b) => a + b, 0)})`
  }).join(' ')
  console.log('facing', facing, say)
}
await b.close()
