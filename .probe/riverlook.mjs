/** Look at the river: centre on the wettest part of the channel and crop the MAP canvas's own pixels. */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'
const OUT = '/home/visiond/.claude/jobs/beedf1c6/tmp/shots'
mkdirSync(OUT, { recursive: true })
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
const PRESET = process.env.PRESET || 'Woodland', RIVER = process.env.RIVER || 'Winds through', SEED = +(process.env.SEED || 5)
await p.getByRole('button', { name: new RegExp('^' + PRESET) }).first().click(); await p.waitForTimeout(400)
await pick('River', RIVER); await pick('Exits', '2'); await pick('Pathways', '2')
await p.evaluate(s => { let t = s; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } }, SEED)
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3500)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(400)
const bands = await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const by = {}
  let sc = 0, sr = 0, n = 0
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const k = g.floorAt(c, r)?.tileKey ?? ''
    if (!/^water/.test(k)) continue
    by[k] = (by[k] ?? 0) + 1; sc += c; sr += r; n++
  }
  return { by, col: Math.round(sc / n), row: Math.round(sr / n), n }
})
console.log('water cells:', JSON.stringify(bands.by), 'centre', bands.col + ',' + bands.row)
const bx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(120) }
await p.waitForTimeout(800)
const png = await p.evaluate(({ col, row }) => {
  const { toScreen, tileH } = globalThis.__nebulithProject
  const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  const pt = toScreen(col, row)
  const W = 760, H = 500
  const sx = Math.max(0, Math.min(cv.width - W, Math.round(pt.x - W / 2)))
  const sy = Math.max(0, Math.min(cv.height - H, Math.round(pt.y - H / 2 - tileH * 3)))
  const out = document.createElement('canvas'); out.width = W; out.height = H
  out.getContext('2d').drawImage(cv, sx, sy, W, H, 0, 0, W, H)
  return out.toDataURL('image/png')
}, bands)
writeFileSync(`${OUT}/${process.env.TAG || 'river-now'}.png`, Buffer.from(png.split(',')[1], 'base64'))
console.log('saved', process.env.TAG || 'river-now')
await b.close()
