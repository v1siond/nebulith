/** The ONE detector that never gave a false positive: a clear-coloured region the background cannot reach.
 *  Run it at several viewport sizes, because the visible-cell window is derived from the canvas size. */
import { chromium } from 'playwright'
const sizes = [[1400, 900], [1920, 1080], [2560, 1440], [3440, 1440]]
const b = await chromium.launch()
for (const [W, H] of sizes) {
  const p = await b.newPage({ viewport: { width: W, height: H } })
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
  await p.getByRole('button', { name: /^Jungle/ }).first().click()
  await p.waitForTimeout(400)
  await pick('River', 'Winds through'); await pick('Exits', '2'); await pick('Pathways', '2')
  await p.evaluate(() => { let t = 5; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
  await p.getByRole('button', { name: /Build this world/ }).click()
  await p.waitForTimeout(3200)
  await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
  await p.waitForTimeout(400)
  const enclosed = await p.evaluate(() => {
    // THE MAP canvas, which is the BIGGEST one: the Preview panel holds its own little thumbnail canvas and
    // `querySelector('canvas')` returns that one. Every pixel measurement I took was of the thumbnail.
    const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
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
    let inside = 0
    for (let n = 0; n < width * height; n++) if (!seen[n] && clear(n * 4)) inside++
    return inside
  })
  console.log(`${W}x${H}: enclosed clear pixels = ${enclosed}`)
  if (enclosed > 500) await p.locator('canvas').first().screenshot({ path: `/home/visiond/.claude/jobs/beedf1c6/tmp/shots/vp-${W}x${H}.png` })
  await p.close()
}
await b.close()
