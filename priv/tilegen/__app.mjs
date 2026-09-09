import { chromium } from 'playwright'
const URL = 'http://localhost:3000/personal-projects/game-engine/games/97829bd2-78fa-4d8f-94aa-8d0cea5f8ffb'
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1680,height:1000}})
const errs = []
p.on('pageerror', e => errs.push(e.message))
p.on('console', m => { if (m.type()==='error') errs.push('console: ' + m.text().slice(0,140)) })
await p.goto(URL, { waitUntil: 'networkidle', timeout: 60000 })
await p.waitForTimeout(6000)
console.log(await p.evaluate(() => {
  const main = document.querySelector('main')
  if (!main) return { error: 'no <main>' }
  const cs = getComputedStyle(main)
  const R = sel => { const e = document.querySelector(sel); if (!e) return null
    const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.left)},${Math.round(r.top)}` }
  return {
    mainClass: main.className,
    display: cs.display,
    areas: cs.gridTemplateAreas.slice(0, 90),
    cols: cs.gridTemplateColumns,
    rows: cs.gridTemplateRows,
    zTop: R('.z-top'), zRail: R('.z-rail'), zPanel: R('.z-panel'),
    canvas: R('canvas.z-canvas'), zInsp: R('.z-insp'), zBar: R('.z-bar'),
  }
}))
console.log('page errors:', errs.length ? errs.slice(0,5) : 'none')
await p.screenshot({ path: process.argv[2] + '/app-01-grid.png' })
await b.close()
