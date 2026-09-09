import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1680,height:1000}})
const errs = []
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0,220)))
p.on('console', m => { if (m.type()==='error') errs.push('CONSOLE ' + m.text().slice(0,220)) })
p.on('framenavigated', f => errs.push('NAVIGATED ' + f.url().slice(-60)))
await p.goto('http://localhost:3000/personal-projects/game-engine/games/97829bd2-78fa-4d8f-94aa-8d0cea5f8ffb', {waitUntil:'networkidle', timeout:70000})
await p.waitForTimeout(7000)
const stats = () => p.evaluate(() => {
  const cv = document.querySelector('.minimap .mmcanvas')
  if (!cv) return { present: false }
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
  let lit = 0, accent = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] + d[i+1] + d[i+2] > 60) lit++
    if (d[i+2] > 200 && d[i] < 140) accent++
  }
  return { present: true, size: `${cv.width}x${cv.height}`, lit, accent, total: d.length / 4 }
})
console.log('empty level  :', JSON.stringify(await stats()))
console.log('grid kinds   :', await p.evaluate(() => typeof window.__gridKinds === 'function' ? Object.keys(window.__gridKinds()).length : 'no probe'))
await p.locator('.z-rail button', { hasText: 'New world' }).click(); await p.waitForTimeout(900)
await p.locator('.z-panel button', { hasText: 'Build this world' }).click(); await p.waitForTimeout(5000)
console.log('grid kinds   :', await p.evaluate(() => typeof window.__gridKinds === 'function' ? Object.keys(window.__gridKinds()).length : 'no probe'))
console.log('after build  :', JSON.stringify(await stats()))
console.log('main present :', await p.locator('main.neb').count(), '| error boundary text:', (await p.locator('body').innerText()).slice(0,180).replace(/\n+/g,' | '))
await p.screenshot({ path: process.argv[2] + '/minimap2.png' })
console.log('errors:', errs.length ? errs.slice(0,3) : 'none')
await b.close()
