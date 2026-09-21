/** One build through the UI, saved, with the unbordered cells and their neighbourhood printed. */
import { chromium } from 'playwright'
import { BASE } from './base.mjs'
import { logIn } from './logIn.mjs'
import { openScratchMap, dropScratchMap } from './scratchMap.mjs'

const isWater = l => !!l && /water|oasis|koi_pond/.test(l)
const sfx = l => (/_(tl|t|tr|l|c|r|bl|b|br)$/.exec(String(l).replace(/_f\d$/, '')) ?? [, ''])[1]
const RIM = { tl: 'NW', t: 'N', tr: 'NE', l: 'W', c: '', r: 'E', bl: 'SW', b: 'S', br: 'SE' }
const SIDES = [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]]

const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } })
// The editor is behind a login, and the /api reads below ride the session cookie.
await logIn(page, BASE)
// Its own map, always: this gate SAVES, and Save writes over whatever is open.
const scratchId = await openScratchMap(page, BASE)
await page.getByRole('button', { name: /^Woodland/ }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Winds through/ }).first().click()
await page.waitForTimeout(250)
await page.getByRole('button', { name: /Build this world/ }).click()
await page.waitForTimeout(5000)
await page.getByLabel(/Save (map|template)/).first().click()
await page.waitForTimeout(2500)

const saved = await page.evaluate(async base => {
  const list = await (await fetch(`${base}/api/templates`)).json()
  const newest = [...list.templates].sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)))[0]
  const one = await (await fetch(`${base}/api/templates/${newest.id}`)).json()
  return one.template ?? one
}, BASE)
const g = saved.groundData
// What is STANDING in each cell, because the edge pass excludes a cell with something blocking in it: a
// boulder midstream gets a shore around it (WATER.md §5c), so that cell is "not water" to the border.
const blocked = new Set()
for (const a of (saved.assetsData ?? [])) {
  if (a && a.blocking) blocked.add(`${a.col},${a.row}`)
}
console.log('blocking assets:', blocked.size)
const rows = g.length, cols = g[0].length
const bad = []
const tally = {}
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const here = g[r][c]
  if (!isWater(here)) continue
  tally[sfx(here) || '(none)'] = (tally[sfx(here) || '(none)'] ?? 0) + 1
  const rim = RIM[sfx(here)] ?? ''
  for (const [n, dc, dr] of SIDES) {
    const nr = r + dr, nc = c + dc
    if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue
    if (isWater(g[nr][nc]) && !blocked.has(`${nc},${nr}`)) continue
    if (!rim.includes(n)) bad.push({ c, r, here, side: n, neighbour: g[nr][nc] })
  }
}
console.log('suffix tally:', JSON.stringify(tally))
console.log('unbordered:', bad.length)
for (const x of bad.slice(0, 10)) {
  const around = SIDES.map(([n, dc, dr]) => `${n}=${g[x.r + dr]?.[x.c + dc] ?? 'off'}${blocked.has(`${x.c + dc},${x.r + dr}`) ? '*' : ''}`).join(' ')
  console.log(`  ${x.c},${x.r} wears ${x.here}  meets ${x.side}=${x.neighbour}   around: ${around}   (* = something standing in it)`)
}
await dropScratchMap(page, scratchId)
await b.close()
