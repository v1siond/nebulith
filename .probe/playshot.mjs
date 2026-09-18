// A SHOT IN PLAY MODE. His instruction: *"make sure to always be on play mode to avoid this"*. Play mode
// drops the editor chrome and the panels, so the camera frames the map itself and a zoom does what it says.
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3200)
if (process.env.CATEGORY) {
  await p.evaluate(cat => {
    for (const sel of document.querySelectorAll('select')) {
      const hit = [...sel.options].find(o => new RegExp('^' + cat, 'i').test(o.text))
      if (!hit) continue
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, hit.value)
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      return
    }
  }, process.env.CATEGORY)
  await p.waitForTimeout(700)
}
await p.getByRole('button', { name: new RegExp('^' + (process.env.PRESET || 'Woodland')) }).first().click()
await p.waitForTimeout(500)
if (process.env.SEASON) {
  await p.evaluate(s => {
    for (const sel of document.querySelectorAll('select')) {
      // MATCH ON THE OPTIONS, not the label: the season select carries no label text, so a label matcher
      // silently built spring while the probe reported autumn.
      const opts = [...sel.options].map(o => o.text.toLowerCase())
      if (!opts.includes('spring') || !opts.includes('autumn')) continue
      const o = [...sel.options].find(x => new RegExp(s, 'i').test(x.text))
      if (o) { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, o.value); sel.dispatchEvent(new Event('change', { bubbles: true })) }
    }
  }, process.env.SEASON)
  await p.waitForTimeout(600)
}
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(3200)
const played = await p.evaluate(() => {
  for (const el of document.querySelectorAll('button')) if (/Play/.test((el.textContent || '').trim())) { el.click(); return el.textContent.trim() }
  return false
})
console.log('play mode:', played)
await p.waitForTimeout(2000)
const bx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
for (let i = 0; i < Number(process.env.ZOOM || 2); i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(150) }
await p.waitForTimeout(900)
const png = await p.evaluate(() => [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0].toDataURL('image/png'))
writeFileSync(process.env.OUT || '/home/visiond/.claude/jobs/beedf1c6/tmp/play.png', Buffer.from(png.split(',')[1], 'base64'))
console.log('saved')
await b.close()
