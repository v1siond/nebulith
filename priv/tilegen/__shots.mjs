import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1680,height:1000}})
await p.goto('http://localhost:3000/personal-projects/game-engine/games/97829bd2-78fa-4d8f-94aa-8d0cea5f8ffb', {waitUntil:'networkidle', timeout:60000})
await p.waitForTimeout(5500)
for (const [rail, file] of [['Characters','characters'], ['Objects','objects'], ['New world','newworld']]) {
  await p.locator('.z-rail button', { hasText: rail }).click(); await p.waitForTimeout(1000)
  if (rail !== 'New world') { await p.locator('.z-panel .sw').nth(4).hover(); await p.waitForTimeout(500) }
  await p.screenshot({ path: `${process.argv[2]}/final-${file}.png` })
}
await b.close()
