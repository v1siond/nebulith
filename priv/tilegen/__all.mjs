import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1680,height:1000}})
const errs = []; const bad = []
p.on('pageerror', e => errs.push(e.message))
p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()) })
await p.goto('http://localhost:3000/personal-projects/game-engine/games/97829bd2-78fa-4d8f-94aa-8d0cea5f8ffb', {waitUntil:'networkidle', timeout:60000})
await p.waitForTimeout(5000)
for (const name of ['New world', 'Tiles', 'Objects', 'Characters', 'Rules', 'Player UI']) {
  await p.locator('.z-rail button', { hasText: name }).click(); await p.waitForTimeout(900)
  const r = await p.evaluate(() => {
    const panel = document.querySelector('.z-panel')
    return {
      head: panel?.querySelector('.lhead .lt')?.textContent ?? '—',
      strip: !!panel?.querySelector('.pvw'),
      swatches: panel?.querySelectorAll('.sw').length ?? 0,
      pictures: panel?.querySelectorAll('.sw img').length ?? 0,
      filters: panel?.querySelectorAll('.frow').length ?? 0,
      info: panel?.querySelectorAll('button.i').length ?? 0,
      empty: (panel?.textContent ?? '').trim().length < 40,
    }
  })
  console.log(name.padEnd(11), JSON.stringify(r))
  await p.screenshot({ path: `${process.argv[2]}/rail-${name.replace(/ /g,'-').toLowerCase()}.png` })
}
console.log('\npage errors:', errs.length ? errs.slice(0,4) : 'none')
console.log('HTTP failures:', bad.length ? bad.slice(0,4) : 'none')
await b.close()
