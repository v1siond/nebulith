/**
 * EVERY TREE, SIDE BY SIDE, AT A SIZE YOU CAN JUDGE.
 *
 *     bin/e2e treeSheet            (via bin/e2e)
 *
 * This tool should have existed before anybody changed a trunk. Three changes to tree geometry were
 * made and shipped on the strength of numbers read out of the database, and each one was reported back
 * as wrong from a screenshot. The numbers were not lying. They were answering a different question:
 * "is the authored spread present in the data" is not "does a forest look like a forest", and no
 * assertion about a column can tell you that a trunk is wedged into the corner of its own cell or that
 * a crown is floating above the post it is meant to sit on.
 *
 * A generated woodland plants whichever three or four species the region calls for, so looking at one
 * is looking at a sample. This stamps EVERY composition whose name is a tree or a bush, in a row, on
 * flat ground, and saves the picture.
 *
 * It asserts nothing. It is a thing to look at, which is the point: the defects it is for are the ones
 * that are obvious to an eye and invisible to a query.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { BASE } from './base.mjs'
import { logIn } from './logIn.mjs'
import { openScratchMap, dropScratchMap } from './scratchMap.mjs'

const OUT = process.argv[2] ?? 'docs/renders/tree-sheet.png'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } })

await logIn(page, BASE)
const scratchId = await openScratchMap(page, BASE, { cols: 80, rows: 12, name: 'e2e tree sheet' })
await page.waitForFunction(() => !!window.__nebulithGrid && !!window.__nebulithStamp, null, { timeout: 30000 })

// THE SPECIES LIST COMES FROM THE BACKEND, which is where compositions live. `__nebulithTilesets` is
// the list of loaded STYLE IDS, not a catalogue, and reading it as one is how this first asked for
// `.compositions` on an array of strings.
const planted = await page.evaluate(async () => {
  const grid = window.__nebulithGrid
  const stamp = window.__nebulithStamp
  const served = await (await fetch('/api/tilesets')).json()
  const ascii = (served.data ?? []).find(t => /ascii/i.test(t.key ?? t.name ?? '')) ?? (served.data ?? [])[0]
  const kinds = Object.keys(ascii?.compositions ?? {}).filter(k => /^(tree|bush)/.test(k)).sort()

  // Flat ground, nothing else on it, so the only thing in the picture is the tree.
  grid.clearAssets?.()
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) grid.setGround(c, r, 'grass')

  // One species every third cell along one row, so no crown overlaps its neighbour.
  const row = Math.floor(grid.rows / 2)
  kinds.forEach((kind, i) => stamp(grid, kind, 2 + i * 3, row, 'spring', i, 0, {}, 0))

  return { kinds, row }
})

if (!planted.kinds.length) throw new Error('no tree compositions in the catalogue, nothing to draw')

// Frame the row. The camera follows the hero, so the hero goes to the row.
await page.evaluate(({ row }) => {
  const g = window.__nebulithGrid
  if (g?.player) { g.player.col = 2; g.player.row = row }
}, planted)
await page.waitForTimeout(2500)

mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true })
const canvas = page.locator('canvas.nebcanvas').first()
await (await canvas.count() ? canvas : page.locator('canvas').first()).screenshot({ path: OUT })

// THE NUMBERS BESIDE THE PICTURE, so a gap you can see has a value you can chase.
const measured = await page.evaluate(() => {
  const grid = window.__nebulithGrid
  const by = {}
  for (const a of grid.assets) {
    const label = a.label ?? a.tileKey ?? a.type
    if (!/^(trunk|leaf)/.test(String(label))) continue
    const key = `${a.col},${a.row}`
    by[key] ??= {}
    by[key][String(label).startsWith('trunk') ? 'trunk' : 'leaf'] = {
      level: a.heightLevel, height: a.height, width: a.width,
      dy: a.pose?.dy ?? 0,
      // THE DRAWN WIDTH, which for a centred block pulled in on all four faces is `2 * reach - 1`.
      // Reporting the reach itself made a 0.24-wide trunk read as 0.62 and hid the very thing the
      // column exists to show.
      reach: a.thickness ? 2 * Object.values(a.thickness)[0] - 1 : (a.width ?? 1),
    }
  }
  return Object.entries(by).filter(([, v]) => v.trunk && v.leaf).slice(0, 8).map(([cell, v]) => ({
    cell,
    trunkTop: (v.trunk.level ?? 0) + (v.trunk.height ?? 0),
    leafBase: (v.leaf.level ?? 0) + (v.leaf.dy ?? 0),
    trunkWidth: v.trunk.reach,
    leafWidth: v.leaf.width,
  }))
})

console.log('\n  cell      trunk top   leaf base    GAP     trunk/crown')
for (const m of measured) {
  const gap = m.leafBase - m.trunkTop
  const ratio = m.trunkWidth && m.leafWidth ? (m.trunkWidth / m.leafWidth) : null
  console.log(`  ${m.cell.padEnd(9)} ${m.trunkTop.toFixed(2).padStart(8)} ${m.leafBase.toFixed(2).padStart(11)} ${gap.toFixed(3).padStart(8)}   ${ratio ? ratio.toFixed(3) : '-'}`)
}

console.log(`\n${planted.kinds.length} species: ${planted.kinds.join(', ')}`)
console.log(`\nwrote ${OUT}`)

await dropScratchMap(page, scratchId)
await browser.close()
