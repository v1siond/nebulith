/**
 * THE REGION SHEET: every region of every biome, on a real build, as numbers and as a picture.
 *
 * `REGIONS.md` §6 asks for region work to be measured region by region rather than eyeballed on one
 * screenshot, and the working protocol says that when the tool for judging a whole FAMILY does not exist,
 * building it is the first task. This is that tool.
 *
 * Per biome it reports, per region: what share of the map it took, how densely it is planted, which species
 * it actually grew, how many distinct leaf tones stand in it, and what its floor is. Plus the region map
 * itself as JSON, so the arrangement (rings / bands / scatter) can be drawn and looked at.
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'

const OUT = process.env.OUT || '/home/visiond/.claude/jobs/beedf1c6/tmp/regions'
mkdirSync(OUT, { recursive: true })
const BIOMES = (process.env.PRESETS || 'Woodland,Jungle,Meadow,Swamp,Mountain,Beach,Ruins,Desert,Volcanic').split(',')

/**
 * WAIT FOR THE MAP TO STOP CHANGING, rather than for a guessed number of milliseconds.
 *
 * The stage is applied to the grid cell by cell after generation finishes, and a sheet read in between is a
 * half-built map that does not look like one. Measured on a mountain: one read put the summit's tone across
 * the foot with the relief scrambled, the next read reported all five bands as one flat brown floor. Both
 * were the same map caught mid-apply. `groundVersion` is the grid's own counter, so this asks it.
 */
const version = page => page.evaluate(() => globalThis.__nebulithGrid?.groundVersion ?? -1)

const settled = async (page, before) => {
  await page.locator('[role="status"]').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  await page.locator('[role="status"]').first().waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})
  // CHANGED, then STOPPED changing. The page stores its region map before it applies the grid, so waiting
  // only for the map to stop changing reads the new build's regions against the previous build's ground.
  for (let i = 0; i < 80 && before !== undefined; i++) {
    if (await version(page) !== before) break
    await page.waitForTimeout(300)
  }
  let last = -1
  for (let i = 0; i < 40; i++) {
    const now = await version(page)
    if (now === last && now >= 0) return
    last = now
    await page.waitForTimeout(400)
  }
}

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })

for (const biome of BIOMES) {
  await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
  await p.waitForTimeout(2600)
  // A CATEGORY first, when asked: the preset buttons only list the kind of place currently selected, so a
  // city preset is simply not on the page until the picker is moved off Wilderness.
  if (process.env.CATEGORY) {
    await p.evaluate(cat => {
      for (const sel of document.querySelectorAll('select')) {
        const hit = [...sel.options].find(o => new RegExp('^' + cat, 'i').test(o.text))
        if (!hit) continue
        Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, hit.value)
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        return
      }
    }, process.env.CATEGORY)
    await p.waitForTimeout(700)
  }
  const ok = await p.getByRole('button', { name: new RegExp('^' + biome) }).first().click().then(() => true).catch(() => false)
  if (!ok) { console.log(biome, 'NOT FOUND'); continue }
  await p.waitForTimeout(400)
  const beforeBuild = await version(p)
  await p.getByRole('button', { name: /Build this world/ }).click()
  await settled(p, beforeBuild)

  const data = await p.evaluate(() => {
    const regions = globalThis.__regionMap?.()
    const grid = globalThis.__nebulithGrid
    if (!regions || !grid) return { error: 'no regions on this map' }
    const slugs = grid.groundSlugs?.() ?? []
    const per = {}
    const bump = (key, field, v = 1) => {
      per[key] ??= { cells: 0, trees: 0, plants: 0, species: {}, tones: new Set(), floors: {} }
      if (field === 'species') per[key].species[v] = (per[key].species[v] || 0) + 1
      else if (field === 'tone') per[key].tones.add(v)
      else if (field === 'floor') per[key].floors[v] = (per[key].floors[v] || 0) + 1
      else per[key][field] += v
    }
    for (let r = 0; r < regions.length; r++) {
      for (let c = 0; c < (regions[r] || []).length; c++) {
        const key = regions[r][c]
        if (!key) continue
        bump(key, 'cells')
        const slug = slugs?.[r]?.[c]
        if (slug) bump(key, 'floor', slug)
      }
    }
    // COUNT THE BASE CELL by `type`, the way `__treeKinds` does: a cactus has no trunk and a bush has none
    // either, so a label-matching tally reports zero cacti on a desert that is full of them.
    for (const a of (grid.assets || [])) {
      const key = regions?.[a.row]?.[a.col]
      if (!key) continue
      const kind = a.type ?? ''
      if (/^(tree|cactus|bush)/.test(kind) && (a.heightLevel ?? 0) === 0) {
        bump(key, 'trees'); bump(key, 'species', kind.replace(/^tree_/, ''))
      }
      const label = a.label || ''
      if (/grass|thicket|shrub|clover|wheat/.test(label)) bump(key, 'plants')
      if (/^leaf_/.test(label) && a.color) bump(key, 'tone', a.color)
    }
    const out = {}
    for (const [k, v] of Object.entries(per)) {
      const top = Object.entries(v.species).sort((a, b) => b[1] - a[1]).slice(0, 3)
      out[k] = {
        cells: v.cells, trees: v.trees, plants: v.plants, tones: v.tones.size,
        species: top.map(([s, n]) => `${s}:${n}`).join(' '),
        floor: Object.entries(v.floors).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '?',
      }
    }
    return { regions, per: out, cols: regions[0]?.length ?? 0, rows: regions.length }
  })

  if (data.error) { console.log(biome.padEnd(9), data.error); continue }
  writeFileSync(`${OUT}/${biome}.json`, JSON.stringify(data))
  const total = Object.values(data.per).reduce((n, v) => n + v.cells, 0) || 1
  console.log(`\n=== ${biome} ${data.cols}x${data.rows} ===`)
  for (const [key, v] of Object.entries(data.per)) {
    const dens = v.cells ? (v.trees / v.cells * 100).toFixed(1) : '0.0'
    console.log(`  ${key.padEnd(11)} ${String(Math.round(v.cells / total * 100)).padStart(3)}% of map | ` +
      `${String(v.trees).padStart(4)} trees (${dens.padStart(5)}/100 cells) | ${String(v.tones).padStart(2)} tones | ` +
      `${v.species.padEnd(34)} | floor ${v.floor}`)
  }
}
await b.close()
