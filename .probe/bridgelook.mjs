/** LOOK AT THE BRIDGE, at all four camera facings. Centres the camera on the crossing, zooms in, and crops the
 *  MAP canvas's own pixels (toDataURL) so no panel can sit over what is being judged. */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'
const OUT = '/home/visiond/.claude/jobs/beedf1c6/tmp/shots/bridge'
mkdirSync(OUT, { recursive: true })
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
const pick = async (label, value) => p.evaluate(([label, value]) => {
  for (const s of document.querySelectorAll('select')) {
    const t = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '')
    if (!t.trim().startsWith(label)) continue
    const o = [...s.options].find(x => x.text === value || x.text.startsWith(value) || x.value === value)
    if (!o) return false
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, o.value)
    s.dispatchEvent(new Event('change', { bubbles: true })); return true
  }
  return false
}, [label, value])
const PRESET = process.env.PRESET || 'Woodland', RIVER = process.env.RIVER || 'Winds through', SEED = +(process.env.SEED || 5)
await p.getByRole('button', { name: new RegExp('^' + PRESET) }).first().click(); await p.waitForTimeout(400)
await pick('River', RIVER); await pick('Exits', '2'); await pick('Pathways', '2')
// THE CROSSING STYLE. Left unset this defaults to whatever the option's first choice is, which is the dirt
// path, and a dirt path stamps no composition at all: four seeds in a row reported "NONE on this map" while
// the bridge being judged was sitting unplaced in the catalogue.
const gotBridge = await pick('Kind of crossing', process.env.BRIDGE || 'Stone bridge')
console.log('crossing style picked:', gotBridge, '|', await p.evaluate(() => [...document.querySelectorAll('select')].map(s => (s.closest('label')?.innerText || '').split('\n')[0].trim()).join(' / ')))
await p.evaluate(s => { let t = s; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } }, SEED)
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3200)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(400)

// Where the bridge is, asked of the grid rather than guessed from the picture.
// WHAT TO LOOK AT. A dirt crossing stamps no composition, so hunting `bridge_` finds nothing on one: it is
// the route with a film of water over it, and the film is what marks the cells.
const deck = await p.evaluate(want => {
  const g = globalThis.__nebulithGrid
  const cells = (g.assets || []).filter(a => (a.label ?? a.tileKey ?? '').startsWith(want))
  if (!cells.length) return null
  // ONE bridge, not the centroid of all of them: a map has several crossings and their average lands in the
  // water between two of them. Group by proximity and take the biggest group.
  const groups = []
  for (const a of cells) {
    const g = groups.find(g => g.some(b => Math.abs(b.col - a.col) <= 8 && Math.abs(b.row - a.row) <= 8))
    if (g) g.push(a)
    else groups.push([a])
  }
  const pick = groups.sort((a, b) => b.length - a.length)[0]
  const col = Math.round(pick.reduce((s, a) => s + a.col, 0) / pick.length)
  const row = Math.round(pick.reduce((s, a) => s + a.row, 0) / pick.length)
  const by = {}
  for (const a of cells) {
    const k = `${a.label ?? a.tileKey}@lvl${a.heightLevel ?? 0}${(a.depth ?? 1) > 1 ? `d${a.depth}` : ''}`
    by[k] = (by[k] ?? 0) + 1
  }
  const comp = globalThis.__nebulithCompCheck = Object.keys((globalThis.__nebulithGrid, window)).length
  return { col, row, n: cells.length, labels: JSON.stringify(by) }
}, process.env.LABEL || 'bridge_')
console.log((process.env.LABEL || 'bridge_') + ' cells:', deck ? `${deck.n} at ${deck.col},${deck.row} [${deck.labels}]` : 'NONE on this map')
if (!deck) { await b.close(); process.exit(1) }
// Crop around where the RENDERER puts the bridge, asked of its own projection seam rather than eyeballed.
const shot = async tag => {
  const png = await p.evaluate(({ col, row, WH }) => {
    const { toScreen, tileH } = globalThis.__nebulithProject
    const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
    const pt = toScreen(col, row)
    const W = Number(WH[0]), H = Number(WH[1])
    const sx = Math.max(0, Math.min(cv.width - W, Math.round(pt.x - W / 2)))
    const sy = Math.max(0, Math.min(cv.height - H, Math.round(pt.y - H / 2 - tileH * 4)))
    const out = document.createElement('canvas')
    out.width = W; out.height = H
    out.getContext('2d').drawImage(cv, sx, sy, W, H, 0, 0, W, H)
    return out.toDataURL('image/png')
  }, { ...deck, WH: (process.env.CROP || '760x520').split('x') })
  writeFileSync(`${OUT}/${tag}.png`, Buffer.from(png.split(',')[1], 'base64'))
}
// STAND THE HERO AT THE BRIDGE, because the camera follows the hero and nothing else moves it. Without this
// the crop was computed for a cell the renderer had scrolled off the canvas, `toScreen` returned a point
// outside it and the crop clamped to the edge: every shot was the hero standing somewhere else entirely.
//
// A few cells BACK, not on it: `fadeNear` ghosts a whole structure the hero is beside (9.1, fact 5).
const away = Number(process.env.HEROAWAY || 7)
await p.evaluate(({ col, row, away }) => globalThis.__setHero?.(col, row + away), { ...deck, away })
await p.waitForTimeout(700)
const bx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
// ZOOM IS SETTABLE, and the default is low on purpose. Seven notches in put the bridge off the canvas while
// the camera stayed on the hero, so `toScreen` returned a point outside it and the crop clamped to the edge:
// every "bridge" shot was actually a picture of the hero standing somewhere else. And at a close zoom the
// hero is beside the structure, so `fadeNear` ghosts the whole thing (9.1, fact 5).
for (let i = 0; i < Number(process.env.ZOOMIN || 2); i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(120) }
await p.waitForTimeout(600)
// TURN THE CAMERA THE WAY A PLAYER DOES. `__setCameraFacing` only moves the DEFAULT the renderer falls back
// to, and the page passes `cameraFacing` in its params, so setting the global changed nothing and every
// "facing" shot came out identical to facing 0.
const rotate = (await p.locator('button[aria-label*="otate"], button[title*="otate"], button[aria-label*="urn"]').all())[0]
console.log('rotate button:', rotate ? 'found' : 'MISSING')
await shot('face0')
for (const f of [1, 2, 3]) {
  if (!rotate) break
  await rotate.click()
  await p.waitForTimeout(600)
  await shot(`face${f}`)
}
console.log('saved 4 facings to', OUT)
await b.close()
