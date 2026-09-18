/** The entrance at a gate, close up, to compare against the design and the reference picture. */
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
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
const PRESET = process.env.PRESET || 'Woodland'
await p.getByRole('button', { name: new RegExp('^' + PRESET) }).first().click(); await p.waitForTimeout(400)
await pick('River', 'Winds through'); await pick('Exits', '2'); await pick('Pathways', '2')
await p.evaluate(() => { let t = 7; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3500)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(400)
const at = await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  // where the entrance pieces actually landed
  const want = new Set(['dead-tree', 'oak-tree', 'boulder', 'cliff_face', 'pillar', 'torii-gate'])
  const hits = (g.assets || []).filter(a => want.has(a.label ?? a.tileKey ?? ''))
  // the gate FARTHEST from the hero, so the player's own panel is not sitting on top of the thing being judged
  // The SOUTH gate: the camera follows the hero and the hero spawns just inside it, so this is the one
  // entrance that is reliably in frame. Judging a far gate means judging a crop the camera never reached.
  const south = hits.filter(a => a.row >= g.rows - 2).sort((a, b) => a.col - b.col)
  const pickOne = south[Math.floor(south.length / 2)] ?? hits[0]
  return pickOne ? { col: pickOne.col, row: pickOne.row, n: hits.length,
    labels: [...new Set(hits.map(a => a.label ?? a.tileKey))].join(' ') } : null
})
console.log('entrance pieces:', at ? `${at.n} (${at.labels}) first at ${at.col},${at.row}` : 'NONE FOUND')
if (!at) { await b.close(); process.exit(1) }
const bx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
let onScreen = false
for (let z = 0; z < 3 && !onScreen; z++) {
  await p.waitForTimeout(220)
  onScreen = await p.evaluate(({ col, row }) => {
    const { toScreen } = globalThis.__nebulithProject
    const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
    const pt = toScreen(col, row)
    return pt.x > 60 && pt.y > 60 && pt.x < cv.width - 60 && pt.y < cv.height - 60
  }, at)
  if (!onScreen) { await p.mouse.wheel(0, 240); await p.waitForTimeout(120) } // zoom OUT to bring it into frame
}
if (!onScreen) { console.log('REFUSED: the target never came on screen, so any crop would be of somewhere else'); await b.close(); process.exit(1) }
await p.waitForTimeout(600)
const png = await p.evaluate(({ col, row }) => {
  const { toScreen, tileH } = globalThis.__nebulithProject
  const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  const pt = toScreen(col, row)
  const W = 520, H = 400
  const sx = Math.max(0, Math.min(cv.width - W, Math.round(pt.x - W * 0.34)))
  const sy = Math.max(0, Math.min(cv.height - H, Math.round(pt.y - H / 2 - tileH * 7)))
  const out = document.createElement('canvas'); out.width = W; out.height = H
  out.getContext('2d').drawImage(cv, sx, sy, W, H, 0, 0, W, H)
  return out.toDataURL('image/png')
}, at)
writeFileSync(`/home/visiond/.claude/jobs/beedf1c6/tmp/shots/${process.env.TAG || 'entrance'}.png`, Buffer.from(png.split(',')[1], 'base64'))
console.log('saved', process.env.TAG || 'entrance')
await b.close()
