/**
 * A REGION, TESTED CONTROLLED. His instruction, 2026-09-17:
 *
 *   "you're testing wrong, you are testing in complete random mode, that's why it fails ... you must setup the
 *    map to not add extra stuff when you test the regions, no river, no bridge, set a specific number of
 *    pathways, specific exits and validate the exits, the pathways and the overall design actually works and
 *    looks like the region it says it should look like"
 *
 * Randomness masks everything. A region measured on a map that also rolled a river, a bridge and a random
 * number of exits tells you nothing about the region. So this pins EVERY other choice and varies only the
 * region, and it reports the DESIGN: the exits, the ways, the water and the ground, per region.
 *
 *   PRESET=Beach REGION=shore node .probe/region.mjs
 *   PRESET=Woodland REGIONS=edge,deep,glade,thicket,lakeside node .probe/region.mjs
 *
 * RIVER / BRIDGE / EXITS / PATHWAYS override the pinned defaults when a test genuinely wants them.
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'

const OUT = process.env.OUT || '/home/visiond/.claude/jobs/beedf1c6/tmp/region'
mkdirSync(OUT, { recursive: true })
const PRESET = process.env.PRESET || 'Beach'
const RIVER = process.env.RIVER || 'none'      // pinned OFF, so nothing extra is added
const BRIDGE = process.env.BRIDGE || 'none'
const EXITS = process.env.EXITS || '2'
const PATHWAYS = process.env.PATHWAYS || '2'
const CATEGORY = process.env.CATEGORY || ''
const SHOT = process.env.SHOT === '1'

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })

/** Set one <select> by the VALUE it offers, and say whether it took. */
const choose = (page, value) => page.evaluate(v => {
  for (const s of document.querySelectorAll('select')) {
    const o = [...s.options].find(x => x.value === v)
    if (!o) continue
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, o.value)
    s.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }
  return false
}, value)

/**
 * WAIT FOR THE MAP TO STOP CHANGING.
 *
 * The working overlay says GENERATION has finished; it does not say the stage has finished being APPLIED to
 * the grid, and that is written cell by cell. Reading in between gives a half-built map, and it does not look
 * like one: measured on a mountain, one run reported the summit's tone spread across the foot and the relief
 * scrambled, and the next reported every cell of all five bands as one flat brown floor. Both were the same
 * map caught mid-apply.
 *
 * `groundVersion` is the grid's own counter, so this asks the grid when it is done instead of guessing a
 * number of milliseconds.
 */
const version = page => page.evaluate(() => globalThis.__nebulithGrid?.groundVersion ?? -1)

const settled = async (page, before) => {
  // FIRST WAIT FOR IT TO CHANGE. Waiting only for it to stop changing returns instantly when the new build
  // has not begun applying yet, and the page sets its region map BEFORE it applies the grid, so the read got
  // the new build's regions against the previous build's map. Measured on a mountain: the regions were the
  // ordered bands the template serves and the ground was the scatter of the preview built before it, which
  // reads exactly like a generator putting a region's floor and relief in the wrong place.
  for (let i = 0; i < 80 && before !== undefined; i++) {
    if (await version(page) !== before) break
    await page.waitForTimeout(300)
  }
  // THREE SAMPLES THE SAME, not one. The page builds every preset at load, so a single quiet sample lands
  // between two of those builds and reads a map that is about to be replaced.
  let last = -1
  let steady = 0
  for (let i = 0; i < 60; i++) {
    const now = await version(page)
    steady = now === last && now >= 0 ? steady + 1 : 0
    if (steady >= 2) return
    last = now
    await page.waitForTimeout(400)
  }
}

/** Click a named element button (the river course lives on buttons, not a select). */
const press = async (page, rx) => {
  const btn = page.getByRole('button', { name: rx }).first()
  if (!(await btn.count().catch(() => 0))) return false
  await btn.click().catch(() => {})
  await page.waitForTimeout(250)
  return true
}

for (const region of (process.env.REGIONS || process.env.REGION || 'random').split(',')) {
  await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
  await p.waitForTimeout(2600)
  // LET THE PAGE'S OWN FIRST BUILD FINISH before touching anything. Pressing the preset while one is running
  // put the measurement across a build boundary: the grid came from one map and the region map from the next,
  // which reported a lake's cells under a neighbouring region's name. Cross-checked against the painted floor
  // tones, the generator never leaked a cell; the harness did.
  await p.locator('[role="status"]').first().waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})
  // A CATEGORY FIRST, when asked. The preset buttons list only the kind of place currently selected, so a
  // city preset is simply not on the page until the picker is moved off Wilderness.
  if (CATEGORY) {
    await p.evaluate(cat => {
      for (const sel of document.querySelectorAll('select')) {
        const hit = [...sel.options].find(o => new RegExp('^' + cat, 'i').test(o.text))
        if (!hit) continue
        Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, hit.value)
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        return
      }
    }, CATEGORY)
    await p.waitForTimeout(700)
  }
  if (!(await press(p, new RegExp('^' + PRESET)))) { console.log(PRESET, 'NOT FOUND'); break }

  // PIN EVERYTHING ELSE. Water off by name, then the numeric choices, then the region under test.
  await press(p, /^Water$/)
  await press(p, RIVER === 'none' ? /^No river$/ : new RegExp('^' + RIVER, 'i'))
  const pinned = { river: RIVER, bridge: await choose(p, BRIDGE), exits: await choose(p, EXITS), pathways: await choose(p, PATHWAYS) }
  const took = await choose(p, region)
  await p.waitForTimeout(300)

  const beforeBuild = await version(p)
  await p.getByRole('button', { name: /Build this world/ }).click()
  // WAIT FOR THE BUILD TO FINISH, rather than for a guessed number of milliseconds. A fixed wait measured a
  // map that was still being built: the region map came from one build and the grid from the next, which put
  // a lake's cells under a neighbouring region's name and made a region look like it had water it never
  // asked for. The working overlay is the honest signal.
  await p.locator('[role="status"]').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  await p.locator('[role="status"]').first().waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})
  await settled(p, beforeBuild)


  const read = page => page.evaluate(() => {
    const reg = globalThis.__regionMap?.()
    const g = globalThis.__nebulithGrid
    const slugs = g.groundSlugs?.() ?? []
    const rows = slugs.length, cols = slugs[0]?.length ?? 0
    const per = {}
    let water = 0, ways = 0, standing = 0, level = 0
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = slugs[r][c] || '?'
      // A POOL IS NOT A GROUND LABEL. `floodRegionPools` stacks a `water_still` film OVER the floor as a
      // prop, so counting `groundSlugs` alone reports a lakeside with 22% standing water as bone dry, which
      // is what it did. Both are water and they are counted apart, so a carved channel is never confused
      // with a region's own standing water again.
      const stack = g.getAssetsAtCell?.(c, r) ?? []
      const pool = stack.some(a => /water/.test(a.label || ''))
      // THE GROUND's level, which is what a region raises. Two wrong readings before this one: the max over
      // the stack measured the tallest TREE (a flat wood reported relief 3.3), and the floor asset's own
      // `heightLevel` is not where relief lives either. `applyStageToGrid` writes a region's `level` through
      // `grid.setHeight`, so that is the field to ask.
      const lv = g.getHeight?.(c, r) ?? 0
      if (/water/.test(s)) water++
      if (pool) standing++
      if (lv > level) level = lv
      if (/path|road|cobble|trail/.test(s)) ways++
      const k = reg?.[r]?.[c] ?? '-'
      per[k] ??= { cells: 0, water: 0, standing: 0, ways: 0, top: 0, ground: {}, tone: {}, levels: {} }
      // THE REGION'S OWN TONE, which is the most visible thing a region states and was not being measured at
      // all. A region with no floor colour of its own is invisible from above however different its trees are.
      const tint = (g.floorAt?.(c, r)?.color || '').toLowerCase()
      if (tint) per[k].tone[tint] = (per[k].tone[tint] || 0) + 1
      per[k].cells++
      if (/water/.test(s)) per[k].water++
      if (pool) per[k].standing++
      if (lv > per[k].top) per[k].top = lv
      per[k].levels[lv] = (per[k].levels[lv] || 0) + 1
      if (/path|road|cobble|trail/.test(s)) per[k].ways++
      per[k].ground[s] = (per[k].ground[s] || 0) + 1
      // WHAT IS BUILT HERE, which is the whole question for a settlement region: a park is a neighbourhood
      // with no buildings in it, and nothing could measure that.
      if (stack.some(a => /wall|roof/.test(a.label || ''))) per[k].built = (per[k].built || 0) + 1
    }
    // EXITS: holes in the sealed border you can actually walk through
    let exits = 0
    for (let c = 0; c < cols; c++) { if (!g.getCollision?.(c, 0)) exits++; if (!g.getCollision?.(c, rows - 1)) exits++ }
    for (let r = 0; r < rows; r++) { if (!g.getCollision?.(0, r)) exits++; if (!g.getCollision?.(cols - 1, r)) exits++ }
    // EVERY BODY OF WATER, and which regions its cells fall in. A share per region cannot tell a region that
    // owns its lake from one that merely has a neighbour's lake spilling over the line; a body that spans two
    // regions can. One region per body is the pass mark.
    const wet = new Set()
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (/water/.test(slugs[r][c])) wet.add(`${c},${r}`)
      else if ((g.getAssetsAtCell?.(c, r) ?? []).some(a => /water/.test(a.label || ''))) wet.add(`${c},${r}`)
    }
    const seen = new Set()
    const bodies = []
    for (const start of wet) {
      if (seen.has(start)) continue
      seen.add(start)
      const queue = [start]
      const mine = []
      while (queue.length) {
        const cur = queue.pop()
        mine.push(cur)
        const [c, r] = cur.split(',').map(Number)
        for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const n = `${c + dc},${r + dr}`
          if (wet.has(n) && !seen.has(n)) { seen.add(n); queue.push(n) }
        }
      }
      const by = {}
      for (const m of mine) { const [c, r] = m.split(',').map(Number); const k = reg?.[r]?.[c] ?? '-'; by[k] = (by[k] || 0) + 1 }
      bodies.push({ size: mine.length, regions: by })
    }
    return { rows, cols, water, standing, ways, exits, per, bodies }
  })

  // AND THE READ CHECKS ITSELF. A region is given ONE level by `raiseRegions`, so every cell of it stands at
  // the same height by construction. More than one height inside a region therefore means the read is TORN:
  // the region map came from a different build than the ground, which is what the page's own preset sweep at
  // load makes possible and what produced three separate rounds of "the generator puts a region's floor and
  // relief in the wrong place" that the generator was not doing.
  let out
  for (let attempt = 0; attempt < 6; attempt++) {
    out = await read(p)
    const torn = Object.entries(out.per).filter(([, v]) => Object.keys(v.levels).length > 1)
    if (!torn.length) break
    if (attempt === 5) { console.log(`   !! TORN READ: ${torn.map(([k, v]) => `${k} spans levels ${Object.keys(v.levels).join('/')}`).join(', ')}`); break }
    await p.waitForTimeout(1500)
  }

  console.log(`\n=== ${PRESET} / region=${region} (river=${RIVER} bridge=${BRIDGE} exits=${EXITS} pathways=${PATHWAYS}) took=${took} ===`)
  console.log(`   map ${out.cols}x${out.rows} | channel ${out.water} | standing ${out.standing} | way cells ${out.ways} | open border cells ${out.exits}`)
  for (const [k, v] of Object.entries(out.per)) {
    const top = Object.entries(v.ground).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([s, n]) => `${s}:${n}`).join(' ')
    const tone = Object.entries(v.tone).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([s, n]) => `${s}:${n}`).join(' ')
    console.log(`   ${k.padEnd(11)} ${String(v.cells).padStart(5)} cells | chan ${String(v.water).padStart(4)} | stand ${String(v.standing).padStart(4)} | lvl ${v.top} | built ${String(v.built ?? 0).padStart(4)} | ways ${String(v.ways).padStart(4)} | ${top} | ${tone}`)
  }
  // A BODY THAT SPANS REGIONS IS NOT AUTOMATICALLY WRONG. It is wrong for a `lakeside`, whose lake belongs to
  // it; it is exactly RIGHT for a swamp, where `bog`, `sink` and `open_water` are neighbouring degrees of the
  // same wetness and the water across them is one sheet. What to look for is a region that asked for no water
  // carrying some, which the per-region rows above show directly.
  console.log(`   water bodies ${out.bodies.length}${out.bodies.length ? ': ' + out.bodies.map(b => `${b.size}@${Object.keys(b.regions).join('+')}`).join(' ') : ''}`)
  if (SHOT) {
    const png = await p.evaluate(() => [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0].toDataURL('image/png'))
    writeFileSync(`${OUT}/${PRESET}-${region}.png`, Buffer.from(png.split(',')[1], 'base64'))
  }
}
await b.close()
