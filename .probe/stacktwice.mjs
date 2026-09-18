// REPRODUCE: paint the same tile twice onto one cell and count the stack.
// Isolates the stacking PRIMITIVE from the UI click path: __paintTile calls stackAssetTile directly.
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
p.on('console', m => { if (/error/i.test(m.type())) console.log('PAGE-ERR', m.text()) })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: /^Meadow/ }).first().click(); await p.waitForTimeout(500)
await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(3000)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(400)

const out = await p.evaluate(() => {
  const w = globalThis
  // a nature tile (stacks as an asset), picked from the live palette, never hardcoded
  const nature = w.__paletteTiles('nature') || []
  const pick = nature.find(t => /rock|boulder|bush/.test(t.id)) || nature[0]
  const col = 10, row = 10
  const before = w.__stackAt(col, row)
  const r1 = w.__paintTile(pick.id, col, row)
  const after1 = w.__stackAt(col, row)
  const r2 = w.__paintTile(pick.id, col, row)
  const after2 = w.__stackAt(col, row)
  const r3 = w.__paintTile(pick.id, col, row)
  const after3 = w.__stackAt(col, row)
  return { tile: pick.id, tileHeight: r1?.tileHeight, before, after1, after2, after3 }
})
console.log('TILE      :', out.tile, '| catalog height:', out.tileHeight)
console.log('before    :', JSON.stringify(out.before))
console.log('after 1st :', JSON.stringify(out.after1))
console.log('after 2nd :', JSON.stringify(out.after2))
console.log('after 3rd :', JSON.stringify(out.after3))
console.log('STACK GREW:', out.before.length, '->', out.after1.length, '->', out.after2.length, '->', out.after3.length)
await b.close()
