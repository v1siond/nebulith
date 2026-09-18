/** Find DARK NAVY pixels on the canvas and say which cell each one sits on. */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
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
const zoom = Number(process.env.ZOOM || 0)
if (zoom > 0) {
  const cv = await p.$('canvas'); const bx = await cv.boundingBox()
  for (let i = 0; i < zoom; i++) { await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await p.mouse.wheel(0, -240); await p.waitForTimeout(110) }
  await p.waitForTimeout(900)
}
console.log(await p.evaluate(() => {
  const cv = document.querySelector('canvas')
  const ctx = cv.getContext('2d')
  const { data, width, height } = ctx.getImageData(0, 0, cv.width, cv.height)
  // DARK NAVY: very dark, blue-dominant. The canvas clear is #1a1a2e; anything in this family counts.
  const navy = (i) => data[i] < 60 && data[i+1] < 60 && data[i+2] > data[i] + 8 && data[i+2] < 110
  // Flood the background in from the border so only navy INSIDE the drawn map is counted.
  const seen = new Uint8Array(width * height)
  const st = []
  for (let x = 0; x < width; x++) st.push(x, 0, x, height - 1)
  for (let y = 0; y < height; y++) st.push(0, y, width - 1, y)
  while (st.length) {
    const y = st.pop(), x = st.pop()
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    const n = y * width + x
    if (seen[n] || !navy(n * 4)) continue
    seen[n] = 1
    st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1)
  }
  let inside = 0, minX = width, minY = height, maxX = 0, maxY = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const n = y * width + x
    if (seen[n] || !navy(n * 4)) continue
    inside++
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const sample = inside ? [data[((minY + (maxY-minY>>1)) * width + (minX + (maxX-minX>>1))) * 4], data[((minY + (maxY-minY>>1)) * width + (minX + (maxX-minX>>1))) * 4 + 1], data[((minY + (maxY-minY>>1)) * width + (minX + (maxX-minX>>1))) * 4 + 2]] : null
  return JSON.stringify({ navyInside: inside, box: inside ? [minX, minY, maxX, maxY] : null, sampleRGB: sample, canvas: [width, height] })
}))
await b.close()
