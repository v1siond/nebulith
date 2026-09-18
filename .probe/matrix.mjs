/** EVERY forest type against EVERY river, at EVERY camera facing, screenshotted and checked for holes.
 *  One example proves nothing, and a hole that only shows when the map is turned is still a hole. */
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
const OUT = '/home/visiond/.claude/jobs/beedf1c6/tmp/shots/matrix'
mkdirSync(OUT, { recursive: true })

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)

const pick = async (label, value) => p.evaluate(([label, value]) => {
  for (const s of document.querySelectorAll('select')) {
    const text = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '')
    if (!text.trim().startsWith(label)) continue
    const opt = [...s.options].find(o => o.text === value || o.text.startsWith(value) || o.value === value)
    if (!opt) return false
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, opt.value)
    s.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }
  return false
}, [label, value])

/** Variants each preset offers, read from its own select rather than assumed. */
const variantsFor = async preset => p.evaluate(preset => {
  for (const s of document.querySelectorAll('select')) {
    const text = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '')
    if (text.trim().startsWith(preset)) return [...s.options].map(o => o.text)
  }
  return []
}, preset)

// HOLES, the only honest measure: flood the clear colour in from the border, and whatever clear pixels that
// flood cannot reach are enclosed BY THE DRAWN MAP. The per-scanline version this replaced counted the gap
// between the on-canvas hint bar and the map, and the "drawn pixels 90px away in all four directions" version
// before that counted the background off the map's south corner. Also: the MAP canvas is the BIGGEST one, the
// Preview panel holds its own little thumbnail.
const check = async () => p.evaluate(() => {
  const g = globalThis.__nebulithGrid
  const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  const { data, width, height } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
  const clear = n => data[n * 4] === 0x1a && data[n * 4 + 1] === 0x1a && data[n * 4 + 2] === 0x2e
  const seen = new Uint8Array(width * height), st = []
  for (let x = 0; x < width; x++) st.push(x, 0, x, height - 1)
  for (let y = 0; y < height; y++) st.push(0, y, width - 1, y)
  while (st.length) {
    const y = st.pop(), x = st.pop()
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    const n = y * width + x
    if (seen[n] || !clear(n)) continue
    seen[n] = 1
    st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1)
  }
  // ON the map or not. A clear pixel that maps to a cell is a hole in the MAP; one that does not is the HUD
  // text's own letter counters (the enclosed middle of a `d`, a `G`), which the flood cannot reach either.
  let holes = 0, onMap = 0, edge = 0
  const cells = new Map()
  const proj = globalThis.__nebulithProject
  const o = proj.toScreen(0, 0), ec = proj.toScreen(1, 0), er = proj.toScreen(0, 1)
  const m = [ec.x - o.x, er.x - o.x, ec.y - o.y, er.y - o.y]
  const det = m[0] * m[3] - m[1] * m[2]
  for (let n = 0; n < width * height; n++) {
    if (seen[n] || !clear(n)) continue
    holes++
    const dx = (n % width) - o.x, dy = ((n / width) | 0) - o.y
    const col = Math.round((m[3] * dx - m[1] * dy) / det), row = Math.round((-m[2] * dx + m[0] * dy) / det)
    // ON THE MAP, OFF IT, or ON ITS BORDER. The third one matters: the map's outer edge is a zig-zag of
    // diagonal steps, and a sliver of canvas caught in one of those steps rounds to the border CELL rather
    // than off the grid. Counting those as interior holes is what made this instrument disagree with a
    // standalone probe by 37 to 5 on the same scene. An INTERIOR hole is the defect; a border one is the rim
    // (ticket 106) and is measured separately instead of being smuggled into the headline number.
    const on = col >= 0 && row >= 0 && col < g.cols && row < g.rows
    const border = on && (col === 0 || row === 0 || col === g.cols - 1 || row === g.rows - 1)
    if (on && !border) onMap++
    if (border) edge++
    const f = !on ? 'off-map' : border ? `rim:${g.floorAt(col, row)?.tileKey ?? 'BARE'}` : (g.floorAt(col, row)?.tileKey ?? 'BARE')
    cells.set(f, (cells.get(f) ?? 0) + 1)
  }
  let wet = 0
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) if (/water|swamp/.test(g.floorAt(c, r)?.tileKey || '')) wet++
  return { holes, onMap, edge, wet, blame: [...cells].sort((a, c) => c[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${v}`).join(' ') }
})

// TURN THE CAMERA THE WAY A PLAYER DOES. `__setCameraFacing` only moves the DEFAULT the renderer falls back
// to when its params omit one, and the page passes `cameraFacing` every frame. Setting the global changed
// nothing, so a sweep built on it was four copies of facing 0 wearing four different labels.
const rotateButton = async () => (await p.locator('button[aria-label*="otate"], button[title*="otate"], button[aria-label*="urn"]').all())[0]
// WAIT FOR THE TURN TO SETTLE. The camera spins over ~300ms and the map is drawn at a FRACTIONAL turn the
// whole way, which tears thousands of pixels open (ticket 107) — measuring during it scores that tear instead
// of the scene. 1400ms is comfortably past the end of it.
const turnOnce = async () => { const r = await rotateButton(); if (r) { await r.click(); await p.waitForTimeout(1400) } }

const rivers = ['Winds through', 'Divides the map', 'Around the edge']
const rows = []
for (const preset of ['Woodland', 'Jungle', 'Meadow']) {
  await p.getByRole('button', { name: new RegExp('^' + preset) }).first().click()
  await p.waitForTimeout(500)
  const variants = await variantsFor(preset)
  for (const variant of (variants.length ? variants : ['(default)']).filter(v => !/Random/i.test(v))) {
    for (const river of rivers) for (const seed of [5, 11]) {
      await p.getByRole('button', { name: new RegExp('^' + preset) }).first().click()
      await p.waitForTimeout(300)
      if (variant !== '(default)') await pick(preset, variant)
      await pick('River', river)
      await pick('Exits', '2'); await pick('Pathways', '2')
      await p.evaluate(sd => { let t = sd; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } }, seed)
      await p.getByRole('button', { name: /Build this world/ }).click()
      await p.waitForTimeout(2800)
      await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
      await p.waitForTimeout(300)
      // THREE SAMPLES PER FACING, because the map ANIMATES. Water carries frames, so a one-shot reading
      // catches whatever frame happened to be up and the same scene scores 0 or 5 depending on the millisecond
      // it was asked. Take the worst of three, so the number means "the worst this scene ever looks".
      let worst = { onMap: -1, holes: 0 }, worstFace = 0
      for (const f of [0, 1, 2, 3]) {
        if (f > 0) await turnOnce()
        for (let s = 0; s < 3; s++) {
          const r = await check()
          if (r.onMap > worst.onMap) { worst = r; worstFace = f }
          await p.waitForTimeout(230)
        }
      }
      await turnOnce() // the fourth turn brings it back round to facing 0 for the next build
      const tag = `${preset}-${variant}-${river}-s${seed}`.replace(/[^a-z0-9]+/gi, '_')
      if (worst.onMap > 0) {
        for (let i = 0; i < worstFace; i++) await turnOnce()
        await p.locator('canvas').first().screenshot({ path: `${OUT}/${tag}.png` })
        for (let i = worstFace; i < 4; i++) await turnOnce()
      }
      rows.push(`${worst.onMap > 0 ? 'HOLES' : '  ok '} ${String(worst.onMap).padStart(4)} inside, ${String(worst.edge ?? 0).padStart(4)} on the rim (${String(worst.holes).padStart(4)} clear px) @face${worstFace}  wet=${String(worst.wet).padStart(3)}  seed${seed}  ${preset} | ${variant} | ${river}  ${worst.blame}`)
      console.log(rows[rows.length - 1])
    }
  }
}
console.log('\n--- ' + rows.filter(r => r.startsWith('HOLES')).length + ' of ' + rows.length + ' combinations show holes')
await b.close()
