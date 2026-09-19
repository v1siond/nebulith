/** Build the same world several times in ONE session and audit the borders each time. */
import { chromium } from 'playwright'
const BASE = 'http://localhost:6328'
const isWater = l => !!l && /water|oasis|koi_pond/.test(l)
const sfx = l => (/_(tl|t|tr|l|c|r|bl|b|br)$/.exec(String(l).replace(/_f\d$/, '')) ?? [, ''])[1]
const RIM = { tl: 'NW', t: 'N', tr: 'NE', l: 'W', c: '', r: 'E', bl: 'SW', b: 'S', br: 'SE' }
const SIDES = [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]]
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } })
await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.getByRole('button', { name: /^Woodland/ }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Winds through/ }).first().click()
await page.waitForTimeout(250)

for (let pass = 1; pass <= 4; pass++) {
  await page.getByRole('button', { name: /Build this world/ }).click()
  await page.waitForTimeout(4500)
  await page.getByLabel(/Save (map|template)/).first().click()
  await page.waitForTimeout(2500)
  const saved = await page.evaluate(async base => {
    const list = await (await fetch(`${base}/api/templates`)).json()
    const newest = [...list.templates].sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)))[0]
    const one = await (await fetch(`${base}/api/templates/${newest.id}`)).json()
    return one.template ?? one
  }, BASE)
  const g = saved.groundData
  const blocked = new Set()
  for (const a of (saved.assetsData ?? [])) if (a && a.blocking) blocked.add(`${a.col},${a.row}`)
  const tally = {}
  let water = 0, sides = 0, miss = 0, beyond = 0
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[0].length; c++) {
    const here = g[r][c]
    if (!isWater(here)) continue
    water++
    tally[sfx(here) || '(none)'] = (tally[sfx(here) || '(none)'] ?? 0) + 1
    const rim = RIM[sfx(here)] ?? ''
    let open = 0
    for (const [n, dc, dr] of SIDES) {
      const nb = g[r + dr]?.[c + dc]
      if (nb === undefined) continue
      if (isWater(nb) && !blocked.has(`${c + dc},${r + dr}`)) continue
      open++
      sides++
      if (!rim.includes(n)) miss++
    }
    if (open > 2) beyond++
  }
  console.log(`pass ${pass}: water=${water} sides=${sides} standing=${blocked.size} needs3+=${beyond} unbordered=${miss}  tally=${JSON.stringify(tally)}`)
}
await b.close()
