/** The water holes that only appear when the camera is TURNED. Rotates to the named facing, paints every
 *  enclosed clear pixel magenta on the map canvas's own pixels, and names the cells they land on. */
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
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
const FACE = +(process.env.FACE || 2)
await p.getByRole('button', { name: /^Woodland/ }).first().click(); await p.waitForTimeout(400)
await pick('River', 'Winds through'); await pick('Exits', '2'); await pick('Pathways', '2')
await p.evaluate(() => { let t = 5; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3200)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(300)
const bx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
for (let i = 0; i < 7; i++) { await p.mouse.wheel(0, 240); await p.waitForTimeout(100) }
const rot = (await p.locator('button[aria-label*="otate"], button[title*="otate"], button[aria-label*="urn"]').all())[0]
for (let i = 0; i < FACE; i++) { await rot.click(); await p.waitForTimeout(500) }
await p.waitForTimeout(+(process.env.SETTLE ?? 700))
const measure = () => p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const { toScreen } = globalThis.__nebulithProject
  const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  const { data, width, height } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
  const clear = n => data[n * 4] === 0x1a && data[n * 4 + 1] === 0x1a && data[n * 4 + 2] === 0x2e
  const seen = new Uint8Array(width * height), st = []
  for (let x = 0; x < width; x++) st.push(x, 0, x, height - 1)
  for (let y = 0; y < height; y++) st.push(0, y, width - 1, y)
  while (st.length) { const y = st.pop(), x = st.pop()
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    const n = y * width + x; if (seen[n] || !clear(n)) continue; seen[n] = 1
    st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1) }
  const o = toScreen(0, 0), ec = toScreen(1, 0), er = toScreen(0, 1)
  const m = [ec.x - o.x, er.x - o.x, ec.y - o.y, er.y - o.y]
  const det = m[0] * m[3] - m[1] * m[2]
  const out = document.createElement('canvas'); out.width = width; out.height = height
  const oc = out.getContext('2d'); oc.drawImage(cv, 0, 0)
  const img = oc.getImageData(0, 0, width, height)
  const hits = new Map()
  let box = null
  for (let n = 0; n < width * height; n++) {
    if (seen[n] || !clear(n)) continue
    const x = n % width, y = (n / width) | 0
    const dx = x - o.x, dy = y - o.y
    const col = Math.round((m[3] * dx - m[1] * dy) / det), row = Math.round((-m[2] * dx + m[0] * dy) / det)
    if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) continue
    img.data[n * 4] = 255; img.data[n * 4 + 1] = 0; img.data[n * 4 + 2] = 255
    const f = g.floorAt(col, row)
    const k = `${col},${row}:${f?.tileKey}:h${g.getHeight(col, row)}:flow${f?.flow}`
    hits.set(k, (hits.get(k) ?? 0) + 1)
    box = box ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) }
               : { x0: x, y0: y, x1: x, y1: y }
  }
  oc.putImageData(img, 0, 0)
  if (!box) return { png: null, hits: [] }
  // a tight crop around them, so the artefact is visible rather than a speck in a wide frame
  const crop = document.createElement('canvas')
  const pad = 140
  const cx0 = Math.max(0, box.x0 - pad), cy0 = Math.max(0, box.y0 - pad)
  crop.width = Math.min(width - cx0, box.x1 - box.x0 + pad * 2)
  crop.height = Math.min(height - cy0, box.y1 - box.y0 + pad * 2)
  crop.getContext('2d').drawImage(out, cx0, cy0, crop.width, crop.height, 0, 0, crop.width, crop.height)
  return { png: crop.toDataURL('image/png'), hits: [...hits].sort((a, c) => c[1] - a[1]) }
})
// THE WORST OF MANY FRAMES. The map animates, so one reading is one frame's luck.
let out = { png: null, hits: [] }
for (let i = 0; i < 12; i++) {
  const r = await measure()
  const n = r.hits.reduce((s, h) => s + h[1], 0)
  if (n > out.hits.reduce((s, h) => s + h[1], 0)) out = r
  await p.waitForTimeout(180)
}
console.log(`facing ${FACE}, worst of 12 frames:`)
for (const [k, v] of out.hits) console.log(`  ${String(v).padStart(4)}px  ${k}`)
if (out.png) writeFileSync('/home/visiond/.claude/jobs/beedf1c6/tmp/shots/waterhole.png', Buffer.from(out.png.split(',')[1], 'base64'))
if (!out.hits.length) console.log('  no on-map holes')
await b.close()
