/** Save the MAP CANVAS's own pixels (via toDataURL), so no DOM panel can sit on top of what I am judging. */
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
await p.getByRole('button', { name: new RegExp('^' + (process.env.PRESET || 'Jungle')) }).first().click()
await p.waitForTimeout(400)
await pick('River', process.env.RIVER || 'Winds through'); await pick('Exits', '2'); await pick('Pathways', '2')
await p.evaluate(() => { let t = 5; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3500)
const { png, count, canvases } = await p.evaluate(() => {
  const all = [...document.querySelectorAll('canvas')]
  const cv = all.sort((a, b) => b.width * b.height - a.width * a.height)[0]
  const { data, width, height } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
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
  // paint the enclosed holes MAGENTA on a copy so they are unmistakable
  const out = document.createElement('canvas')
  out.width = width; out.height = height
  const octx = out.getContext('2d')
  octx.drawImage(cv, 0, 0)
  const img = octx.getImageData(0, 0, width, height)
  let n2 = 0
  for (let n = 0; n < width * height; n++) {
    if (seen[n] || !clear(n * 4)) continue
    n2++
    img.data[n * 4] = 255; img.data[n * 4 + 1] = 0; img.data[n * 4 + 2] = 255
  }
  octx.putImageData(img, 0, 0)
  return { png: out.toDataURL('image/png'), count: n2, canvases: all.map(c => `${c.width}x${c.height}`) }
})
console.log('canvases on page:', canvases.join(', '), '| enclosed holes:', count)
writeFileSync('/home/visiond/.claude/jobs/beedf1c6/tmp/shots/canvas-holes.png', Buffer.from(png.split(',')[1], 'base64'))
console.log('saved canvas-holes.png')
await b.close()
