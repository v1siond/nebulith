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
// `bin/e2e treeSheet <out> generated` measures the trees a GENERATED world plants, on its own ground,
// at its own elevations. The flat sheet is the controlled case; this is his.
const MODE = process.argv[3] ?? 'sheet'


/**
 * THE GAP BETWEEN A CROWN AND ITS TRUNK, from the geometry the renderer RECORDED as it drew.
 *
 * Not from pixels. A pixel reader has to tell a canopy from a lawn by hue and both are green, so a
 * floating crown measured as a healthy overlap twice: once on the sheet's grass and again on a
 * generated woodland. Not from `level + pose.dy` either, which is how the lift is defined, so the two
 * sides of that comparison can never disagree.
 *
 * `__nebulithDrawn` is the list the selector hit-tests against. It IS the draw.
 */
const measureCrowns = page => page.evaluate(() => {
  const grid = window.__nebulithGrid
  const drawn = window.__nebulithDrawn ?? []

  const yOf = geom => {
    const pts = geom.kind === 'cube' ? [...geom.base, ...geom.top] : geom.pts
    return { top: Math.min(...pts.map(p => p.y)), bottom: Math.max(...pts.map(p => p.y)) }
  }

  const cells = new Map()
  for (const hit of drawn) {
    const asset = grid.getAssetsAtCell?.(hit.col, hit.row)?.[hit.stackIndex]
    if (!asset) continue
    const label = String(asset.label ?? asset.tileKey ?? asset.type)
    const part = /^trunk/.test(label) ? 'trunk' : /^(leaf|canopy)/.test(label) ? 'crown' : null
    if (!part) continue

    const key = `${hit.col},${hit.row}`
    const at = cells.get(key) ?? { cell: key }
    const y = yOf(hit.geom)
    // The trunk's HIGHEST point and the crown's LOWEST, which is where they are supposed to meet.
    if (part === 'trunk') at.trunkTop = Math.min(at.trunkTop ?? Infinity, y.top)
    if (part === 'crown') { at.crownBottom = Math.max(at.crownBottom ?? -Infinity, y.bottom); at.kind = label }
    cells.set(key, at)
  }

  return [...cells.values()]
    .filter(c => c.trunkTop !== undefined && c.crownBottom !== undefined)
    .map(c => ({ cell: c.cell, kind: c.kind, gap: Math.round(c.trunkTop - c.crownBottom) }))
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } })

await logIn(page, BASE)
const scratchId = await openScratchMap(page, BASE, { cols: 34, rows: 34, name: 'e2e tree sheet' })

if (MODE === 'generated') {
  const gen = page.getByRole('button', { name: /^Woodland/ }).first()
  await gen.waitFor({ state: 'visible', timeout: 30000 })
  await gen.click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Build this world/ }).click()
  await page.waitForTimeout(9000)

  const found = await measureCrowns(page)

  const bad = found.filter(f => f.gap >= 0).sort((a, b) => b.gap - a.gap)
  console.log(`\n  ON A GENERATED WOODLAND: ${found.length} trees measured, ${bad.length} whose crown does not sit ON its trunk\n`)
  for (const b of bad.slice(0, 12)) console.log(`  ${b.cell.padEnd(9)} ${b.kind.padEnd(16)} +${b.gap} px`)
  const worst = bad[0]
  if (worst) console.log(`\n  worst: ${worst.kind} at ${worst.cell}, +${worst.gap} px of sky between crown and trunk`)

  await page.locator('canvas').first().screenshot({ path: OUT.replace('.png', '-generated.png') })
  console.log(`\n  wrote ${OUT.replace('.png', '-generated.png')}`)
  await dropScratchMap(page, scratchId)
  await browser.close()
  process.exit(bad.length ? 1 : 0)
}
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

  // GROUND THAT IS NEITHER GREEN NOR BROWN, because the pixel reader tells a canopy from a trunk by
  // hue. On grass every blade counted as canopy, so the crown's "lowest pixel" was the lawn and the
  // measurement came back as a healthy overlap no matter what the trees were doing.
  grid.clearAssets?.()
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) grid.setGround(c, r, 'marble')

  // EVERY SPECIES ON ONE SCREEN. A row of twenty-four runs off the side of the camera, and a sheet that
  // shows half the family is the same anecdote as looking at one tree: the first twelve passed while
  // twelve nobody had drawn sat behind the edge.
  //
  // A grid, four cells apart so no crown touches its neighbour and the pixel reader can tell the trees
  // apart by the empty columns between them.
  const PER_ROW = 6
  const SPACING = 4
  kinds.forEach((kind, i) => {
    const col = 3 + (i % PER_ROW) * SPACING
    const row = 3 + Math.floor(i / PER_ROW) * SPACING
    stamp(grid, kind, col, row, 'spring', i, 0, {}, 0)
  })

  return { kinds, perRow: PER_ROW, spacing: SPACING }
})

if (!planted.kinds.length) throw new Error('no tree compositions in the catalogue, nothing to draw')

// Frame the whole block: the hero goes to its middle and the camera pulls back far enough to hold it.
await page.evaluate(() => {
  const g = window.__nebulithGrid
  if (g?.player) { g.player.col = Math.floor(g.cols / 2); g.player.row = Math.floor(g.rows / 2) }
})
await page.waitForTimeout(600)
await page.evaluate(() => {
  const c = document.querySelector('canvas.nebcanvas') ?? document.querySelector('canvas')
  if (c) for (let i = 0; i < 3; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(2500)

mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true })
const canvas = page.locator('canvas.nebcanvas').first()
await (await canvas.count() ? canvas : page.locator('canvas').first()).screenshot({ path: OUT })

// THE GAP, MEASURED IN PIXELS, which is the only oracle that is not circular.
//
// The first version computed `level + pose.dy` and compared it to the trunk top. That is exactly how the
// lift is DEFINED, so the two sides could never disagree: it reported a gap of 0.000 for every species
// on a sheet where crowns were visibly floating. A test whose expected value is derived from the same
// arithmetic as the actual value passes whatever the code does.
//
// So this reads the canvas. For each species column it finds the lowest CROWN pixel and the highest
// TRUNK pixel and reports the distance between them. A crown that sits on its trunk overlaps it, so a
// seated tree measures zero or negative. A positive number is a floating crown, in pixels, on screen.
const gaps = await measureCrowns(page)

console.log('\n  MEASURED IN PIXELS, positive = the crown floats clear of its trunk\n')
for (const g of gaps) console.log(`  ${g.cell.padEnd(9)} ${String(g.kind).padEnd(16)} ${String(g.gap).padStart(6)} px`)
// A CROWN MUST OVERLAP ITS TRUNK, not merely reach it. Touching at a single pixel row reads as a seam
// with sky through it, and it is what the wrong lift produced: measured, the bad sign put eleven
// species at 0 or +1 while the right one seats every trunked species several pixels deep.
const measurable = gaps
const floating = measurable.filter(g => g.gap >= 0)
console.log(`\n  ${floating.length} of ${measurable.length} trunked species have a crown that does not sit ON its trunk`)
if (floating.length) console.log(`  not seated: ${floating.map(f => `${f.kind} (${f.gap >= 0 ? '+' : ''}${f.gap}px)`).join(', ')}`)
process.exitCode = floating.length ? 1 : 0

console.log(`\n${planted.kinds.length} species: ${planted.kinds.join(', ')}`)
console.log(`\nwrote ${OUT}`)

await dropScratchMap(page, scratchId)
await browser.close()
