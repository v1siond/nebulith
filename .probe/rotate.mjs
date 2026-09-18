/** Build a map, turn the camera, and count CANVAS-CLEAR pixels that the background cannot reach: holes. */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
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
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(5000)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(400)

const holes = async () => p.evaluate(() => {
  const cv = document.querySelector('canvas')
  const ctx = cv.getContext('2d')
  const { data, width, height } = ctx.getImageData(0, 0, cv.width, cv.height)
  const clear = i => data[i] === 0x1a && data[i + 1] === 0x1a && data[i + 2] === 0x2e
  const seen = new Uint8Array(width * height)
  const st = []
  for (let x = 0; x < width; x++) st.push(x, 0, x, height - 1)
  for (let y = 0; y < height; y++) st.push(0, y, width - 1, y)
  while (st.length) {
    const y = st.pop(), x = st.pop()
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    const n = y * width + x
    if (seen[n] || !clear(n * 4)) continue
    seen[n] = 1
    st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1)
  }
  let inside = 0
  for (let n = 0; n < width * height; n++) if (!seen[n] && clear(n * 4)) inside++
  return inside
})

const rotateButtons = await p.locator('button[aria-label*="otate"], button[title*="otate"], button[aria-label*="urn"]').all()
console.log('rotate buttons found:', rotateButtons.length)
console.log('facing 0 holes:', await holes())
for (let i = 1; i <= 3; i++) {
  if (rotateButtons.length === 0) break
  await rotateButtons[0].click()
  await p.waitForTimeout(1400)
  console.log(`facing ${i} holes:`, await holes())
  await p.locator('canvas').first().screenshot({ path: `/home/visiond/.claude/jobs/beedf1c6/tmp/shots/facing${i}.png` })
}
await b.close()
