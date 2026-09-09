import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1680,height:1000}})
await p.goto('http://localhost:3000/personal-projects/game-engine/games/97829bd2-78fa-4d8f-94aa-8d0cea5f8ffb', {waitUntil:'networkidle', timeout:60000})
await p.waitForTimeout(5000)
console.log(await p.evaluate(() => {
  const seg = document.querySelector('.z-bar .seg')
  if (!seg) return 'no seg'
  return [...seg.children].map(btn => {
    const cs = getComputedStyle(btn); const r = btn.getBoundingClientRect()
    return { text: btn.textContent, cls: btn.className, w: Math.round(r.width), h: Math.round(r.height),
             color: cs.color, bg: cs.backgroundColor, fs: cs.fontSize }
  })
}))
// what is the white blob at the far left of the bar?
console.log('bar children:', await p.$$eval('.z-bar > *', ns => ns.map(n => n.className + ' :: ' + (n.textContent||'').slice(0,30).replace(/\s+/g,' '))))
await b.close()
