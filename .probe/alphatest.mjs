/** Does a floor colour with ALPHA leave the canvas showing through? Count holes, strip the alpha in place,
 *  count again. Same map, same frame loop, one variable. */
import { chromium } from 'playwright'
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
await p.getByRole('button', { name: /^Jungle/ }).first().click(); await p.waitForTimeout(400)
await pick('River', 'Winds through'); await pick('Exits', '2'); await pick('Pathways', '2')
await p.evaluate(() => { let t = 5; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3500)

await p.exposeFunction('nothing', () => {})
const count = () => p.evaluate(() => {
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
  let n2 = 0; for (let n = 0; n < width * height; n++) if (!seen[n] && clear(n)) n2++
  return n2
})
console.log('before          :', await count())
await p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  for (const a of g.assets) {
    if (typeof a.color !== 'string') continue
    const m = a.color.match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/)
    if (!m) continue
    a.color = `rgb(${m[1]}, ${m[2]}, ${m[3]})`
  }
  g.groundVersion = (g.groundVersion ?? 0) + 1
})
await p.waitForTimeout(1200)
console.log('alpha stripped  :', await count())
await b.close()
