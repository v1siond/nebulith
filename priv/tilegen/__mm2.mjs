import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1680,height:1000}})
const errs = []
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0,180)))
await p.goto('http://localhost:3000/personal-projects/game-engine/games/97829bd2-78fa-4d8f-94aa-8d0cea5f8ffb', {waitUntil:'networkidle', timeout:70000})
await p.waitForTimeout(7000)
const stats = () => p.evaluate(() => {
  const cv = document.querySelector('.minimap .mmcanvas')
  if (!cv) return { present: false }
  let readable = true, lit = 0, accent = 0
  try {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i+1] + d[i+2] > 60) lit++
      if (d[i+2] > 190 && d[i] < 150) accent++
    }
  } catch (e) { readable = false }
  return { present: true, size: `${cv.width}x${cv.height}`, readable, lit, accent }
})
console.log('empty level :', JSON.stringify(await stats()))
await p.locator('.z-rail button', { hasText: 'New world' }).click(); await p.waitForTimeout(900)
await p.locator('.z-panel button', { hasText: 'Build this world' }).click(); await p.waitForTimeout(5500)
console.log('after build :', JSON.stringify(await stats()))
console.log('map still mounted:', await p.locator('.minimap').count())
await p.screenshot({ path: process.argv[2] + '/minimap-final.png' })
console.log('errors:', errs.length ? errs.slice(0,3) : 'none')
await b.close()
