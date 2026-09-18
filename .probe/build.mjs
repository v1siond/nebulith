import { chromium } from 'playwright'
const OUT = '/home/visiond/.claude/jobs/beedf1c6/tmp/shots'
const opts = JSON.parse(process.env.OPTS || '{}')     // { "Exits": "4", "Pathways": "4", "River": "Divides the map in two" }
const preset = process.env.PRESET || 'Woodland'
const tag = process.env.TAG || 'run'

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
const errs = []
p.on('pageerror', e => errs.push(e.message))
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)

await p.getByRole('button', { name: new RegExp('^' + preset) }).first().click()
await p.waitForTimeout(400)

/** Set a <select> by the label text that precedes it, then fire a real change event. */
for (const [label, value] of Object.entries(opts)) {
  const ok = await p.evaluate(([label, value]) => {
    for (const s of document.querySelectorAll('select')) {
      const text = (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '')
      if (!text.trim().startsWith(label)) continue
      const opt = [...s.options].find(o => o.text === value || o.text.startsWith(value) || o.value === value)
      if (!opt) return `no option ${value} in ${label}: ${[...s.options].map(o => o.text).join('|')}`
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      setter.call(s, opt.value)
      s.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    return `no select labelled ${label}`
  }, [label, value])
  console.log(`  set ${label} = ${value}:`, ok)
  await p.waitForTimeout(250)
}

// SEED THE MAP so two runs are the same world. Without this an A/B compares different rivers and every
// number moves for the wrong reason (it did, and it cost an hour).
if (process.env.SEED) {
  await p.evaluate(seed => {
    let t = Number(seed) >>> 0
    Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 }
  }, process.env.SEED)
}
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(6000)

// Close the Preview panel and zoom out over the canvas so the WHOLE map is in frame, which is the view
// Alexander screenshots from. Wheel-up zooms out in this editor.
// CLOSE EVERY PANEL. The blue "Build this world" button is the same blue as water and my first analysis
// measured IT instead of the river. Nothing but the map may be in frame.
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
for (const collapse of await p.locator('button', { hasText: /^«$/ }).all()) await collapse.click().catch(() => {})
await p.waitForTimeout(500)
const box = await p.locator('canvas').first().boundingBox()
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
for (let i = 0; i < Number(process.env.ZOOM_OUT || 6); i++) { await p.mouse.wheel(0, 240); await p.waitForTimeout(120) }
await p.waitForTimeout(1200)
await p.screenshot({ path: `${OUT}/${tag}-full.png`, clip: { x: 640, y: 60, width: 1280, height: 960 } })

// The canvas alone, at native size, is what we actually inspect.
const canvas = p.locator('canvas').first()
await canvas.screenshot({ path: `${OUT}/${tag}-canvas.png` })
console.log('PAGEERRORS', JSON.stringify(errs.slice(0, 5)))
await b.close()
