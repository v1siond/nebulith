import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1680,height:1000}})
const errs = []; const bad = []
p.on('pageerror', e => errs.push(e.message.slice(0,160)))
p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()) })
await p.goto('http://localhost:3000/personal-projects/game-engine/games/97829bd2-78fa-4d8f-94aa-8d0cea5f8ffb', {waitUntil:'networkidle', timeout:70000})
await p.waitForTimeout(6000)

console.log('── nothing selected ──')
console.log('  inspector:', await p.locator('.z-insp').count(), '(0 = gone, as asked)')
console.log('  collapse handles:', await p.locator('.zcol').count())
console.log('  canvas width:', await p.evaluate(() => Math.round(document.querySelector('.z-canvas').getBoundingClientRect().width)))

console.log('\n── collapse each zone ──')
for (const z of ['z-rail', 'z-panel']) {
  const before = await p.evaluate(s => Math.round(document.querySelector('.'+s).getBoundingClientRect().width), z)
  await p.locator(`.${z} .zcol`).click(); await p.waitForTimeout(350)
  const after = await p.evaluate(s => Math.round(document.querySelector('.'+s).getBoundingClientRect().width), z)
  const label = await p.locator(`.${z} .zname`).isVisible()
  await p.locator(`.${z} .zcol`).click(); await p.waitForTimeout(250)
  console.log(`  ${z}: ${before}px → ${after}px | name readable when shut: ${label}`)
}

console.log('\n── New world (the stepper) ──')
await p.locator('.z-rail button', { hasText: 'New world' }).click(); await p.waitForTimeout(900)
console.log('  numbered steps:', await p.locator('.z-panel b').filter({ hasText: /^[1-4]$/ }).count())
console.log('  kind list rows:', await p.locator('.z-panel .flist .frow').count(), '| preset cards:', await p.locator('.z-panel .pcard').count())
console.log('  build button  :', await p.locator('.z-panel button', { hasText: 'Build this world' }).count())
await p.screenshot({ path: process.argv[2] + '/f-newworld.png' })

console.log('\n── Rules ──')
await p.locator('.z-rail button', { hasText: 'Rules' }).click(); await p.waitForTimeout(700)
console.log('  tab strip:', await p.locator('.z-panel .tabs button').count(), '| rows:', await p.locator('.z-panel .frow').count())
await p.screenshot({ path: process.argv[2] + '/f-rules.png' })

console.log('\n── select a cell → inspector returns, swap panel ──')
await p.locator('.z-canvas canvas').click({ position: { x: 380, y: 300 } }); await p.waitForTimeout(900)
console.log('  inspector:', await p.locator('.z-insp').count(), '| its collapse handle:', await p.locator('.z-insp .zcol').count())
const swap = p.locator('.z-insp button', { hasText: /Swap this tile|Add a tile here/ })
console.log('  swap button:', await swap.count(), await swap.first().textContent().catch(()=>'—'))
if (await swap.count()) {
  await swap.first().click(); await p.waitForTimeout(900)
  console.log('  panel:', await p.locator('.mw .swaprow').count() ? 'before→after shown' : 'MISSING',
              '| carry rows:', await p.locator('.mw .carry i').count(),
              '| picker swatches:', await p.locator('.mw .swapg .sw').count())
  await p.screenshot({ path: process.argv[2] + '/f-swap.png' })
}
console.log('\npage errors:', errs.length ? errs.slice(0,3) : 'none')
console.log('HTTP failures:', bad.length ? bad.slice(0,3) : 'none')
await b.close()
