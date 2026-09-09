import { chromium } from 'playwright'
const URL = 'http://localhost:3000/personal-projects/game-engine/games/97829bd2-78fa-4d8f-94aa-8d0cea5f8ffb'
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1680,height:1000}})
const errs = []
p.on('pageerror', e => errs.push(e.message))
p.on('console', m => { if (m.type()==='error') errs.push('console: ' + m.text().slice(0,160)) })
const bad = []
p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()) })
await p.goto(URL, { waitUntil: 'networkidle', timeout: 60000 })
await p.waitForTimeout(6000)
console.log('rail bands:', await p.$$eval('.z-rail .zn', ns => ns.map(n => n.textContent)))
console.log('rail rows :', await p.$$eval('.z-rail .b.wide', ns => ns.map(n => n.textContent.replace(/\s+/g,' ').trim())))
console.log('art style in top bar:', await p.locator('.z-top .styleb').count(), '| before the game menu:',
  await p.evaluate(() => { const t = document.querySelector('.z-top'); if (!t) return null
    const kids = [...t.querySelectorAll('*')]; const a = kids.findIndex(k => k.classList.contains('styleb'))
    const g = kids.findIndex(k => k.tagName === 'BUTTON' && /Game|All games/.test(k.textContent || ''))
    return a >= 0 && (g < 0 || a < g) }))
console.log('undo/redo:', await p.locator('.z-top button[aria-label="Undo"]').count(), await p.locator('.z-top button[aria-label="Redo"]').count())
// open Tiles and check the library
await p.locator('.z-rail button', { hasText: 'Tiles' }).click(); await p.waitForTimeout(1200)
console.log('library header:', await p.locator('.z-panel .lhead .lt').textContent().catch(()=>'—'))
console.log('preview strip :', await p.locator('.z-panel .pvw').count(), '| swatches:', await p.locator('.z-panel .sw').count(),
            '| pictures:', await p.locator('.z-panel .sw img').count(), '| filter rows:', await p.locator('.z-panel .frow').count())
await p.locator('.z-panel .sw').nth(3).hover(); await p.waitForTimeout(500)
console.log('hover preview :', await p.locator('.z-panel .pvw .pvn').textContent().catch(()=>'—'),
            '| facts:', await p.locator('.z-panel .pvw .fr').count())
console.log('cards left in panel/insp:', await p.locator('.z-panel .rounded-lg, .z-insp .rounded-lg').count())
await p.screenshot({ path: process.argv[2] + '/app-02-tiles.png' })
console.log('page errors:', errs.length ? errs.slice(0,4) : 'none')
console.log('HTTP failures:', bad.length ? bad.slice(0,5) : 'none')
await b.close()
