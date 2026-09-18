import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
await p.getByRole('button', { name: /^Woodland/ }).first().click()
await p.waitForTimeout(800)
// Switch the river on so the water group's dependent options are live rather than greyed.
// The river is a SWATCH STRIP now, not a select, so it is clicked rather than set.
console.log('river switched by swatch:', await p.evaluate(() => {
  for (const b of document.querySelectorAll('.swatches button')) {
    if (/winds/i.test(b.textContent || '')) { b.click(); return b.textContent.trim() }
  }
  return false
}))
await p.waitForTimeout(1200)
// Scroll the options into view so the lazy thumbnails are asked to draw at all.
await p.evaluate(() => document.querySelectorAll('.swatches').forEach(s => s.scrollIntoView({ block: 'center' })))
await p.waitForTimeout(2500)
const panel = p.locator('text=OPTIONS').first()
const box = await panel.count() ? await panel.boundingBox() : null
const el = await p.evaluate(() => {
  const heads = [...document.querySelectorAll('div')].filter(d => /^(Layout|Water|Crossings|Options)$/.test(d.textContent?.trim() || ''))
  return heads.map(h => h.textContent.trim())
})
console.log('group headings rendered:', el)
// How many choice thumbs actually drew, asked of the DOM rather than judged from the picture.
console.log(await p.evaluate(() => {
  const strips = [...document.querySelectorAll('.swatches')]
  return 'swatch strips: ' + strips.length + ' | buttons: ' + strips.reduce((n, s) => n + s.querySelectorAll('button').length, 0) +
    ' | thumbs drawn: ' + strips.reduce((n, s) => n + [...s.querySelectorAll('img')].filter(i => (i.getAttribute('src')||'').startsWith('data:image')).length, 0)
}))
const panelEl = await p.$('.swatches')
if (panelEl) {
  const col = await p.evaluate(() => {
    const s = document.querySelector('.swatches')
    let n = s, best = s
    while (n && n.parentElement) { n = n.parentElement; if (n.scrollHeight > 400) { best = n; break } }
    const r = best.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 900) }
  })
  await p.screenshot({ path: '/home/visiond/.claude/jobs/beedf1c6/tmp/panel.png', clip: { x: Math.max(0, col.x), y: Math.max(0, col.y), width: Math.min(col.width, 460), height: col.height } })
} else {
  await p.screenshot({ path: '/home/visiond/.claude/jobs/beedf1c6/tmp/panel.png' })
}
console.log('saved')
await b.close()
