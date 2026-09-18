// PROOF (temporary harness): on a REAL generated town, a click on a building WALL / DOOR / ROOF block, a
// CHARACTER, a stacked TREE and bare GROUND all resolve through the ONE unified pick + inspector — a wall
// selects a WALL tile (not the grass floor), a character selects the character, a tree selects the tree,
// bare ground stays the floor. Asserts the REAL inspector DOM (`— tile · X —`) + selection seams. 0 console
// errors. Run: BASE_URL=http://localhost:6328 npx playwright test playwright/tours/_unifiedpick.spec.js --project=chromium
import { test, expect } from '@playwright/test'

const clickAt = async (page, pos) => {
  await page.mouse.move(pos.x, pos.y)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(250)
}
// The inspector's TILE section header the USER sees: "— tile · <label> —" (CSS-uppercased). Pull the label
// after the "·" and lowercase it, case-insensitively.
const tileHeader = async (page) => {
  const el = page.locator('p', { hasText: /tile ·/i }).first()
  if (await el.count() === 0) return null
  const m = (await el.innerText()).match(/·\s*([A-Za-z_]+)/)
  return m ? m[1].toLowerCase() : null
}

test('a building wall / door / roof, a character, a tree and bare ground all pick as tiles through ONE path', async ({ page }) => {
  const consoleErrors = []
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`))

  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('/templates?new=1')
  await page.locator('canvas').first().waitFor({ state: 'visible' })

  // Confirm HMR is serving the updated code (the new unified-pick seam exists).
  await expect.poll(() => page.evaluate(() => typeof window.__genVillage), { timeout: 20000 }).toBe('function')

  // Generate a REAL town (retry until it has buildings — generation is randomized).
  let buildings = []
  for (let attempt = 0; attempt < 6 && buildings.length === 0; attempt++) {
    await page.evaluate(() => window.__genVillage())
    await page.waitForTimeout(700)
    await page.evaluate(() => window.__setView && window.__setView('iso'))
    await page.waitForTimeout(300)
    buildings = await page.evaluate(() => window.__buildings())
  }
  const withWall = buildings.filter(b => b.wall)
  expect(withWall.length, 'town generated at least one building with a wall').toBeGreaterThan(0)

  // The union of EVERY building's footprint cells — a clicked cell must be one of these (never bare ground).
  const footprint = new Set()
  for (const bb of buildings) {
    const top = bb.row - (bb.height - 1)
    for (let r = 0; r < bb.height; r++) for (let c = 0; c < bb.length; c++) footprint.add(`${bb.col + c},${top + r}`)
  }
  const BUILDING_PARTS = ['wall', 'window', 'door', 'roof']
  const results = {}

  // ── 1) BUILDING WALL — target the FRONTMOST building (max col+row → drawn on top, un-occluded) and its
  //    camera-near FRONT-LEFT corner (a wall, never the door), clicked at ground level. ──────────────────
  const b = [...withWall].sort((a, z) => (z.col + z.row) - (a.col + a.row))[0]
  const wallCell = { col: b.col, row: b.row } // buildingRect row is the FRONT (bottom) row → a near wall
  await page.evaluate(([c, r]) => window.__centerOn(c, r), [wallCell.col, wallCell.row])
  await page.waitForTimeout(300)
  let pos = await page.evaluate(([c, r]) => window.__isoBlockScreen(c, r, 1), [wallCell.col, wallCell.row])
  await clickAt(page, pos)
  const wallSel = await page.evaluate(() => window.__cellSel())
  const wallLabel = await tileHeader(page)
  results.wall = { aimedWallCell: `${wallCell.col},${wallCell.row}`, selectedFirst: wallSel.first, tileHeader: wallLabel }
  expect(footprint.has(wallSel.first), 'clicking a wall selects a building FOOTPRINT cell, not bare ground').toBe(true)
  expect(['wall', 'window'], 'inspector shows a WALL/window tile, not the grass floor or a roof').toContain(wallLabel)

  // ── 2) BUILDING ROOF — click the roof cap (level = floors+1) over the same cell ───────────────────
  pos = await page.evaluate(([c, r, lvl]) => window.__isoBlockScreen(c, r, lvl), [wallCell.col, wallCell.row, b.floors + 1])
  await clickAt(page, pos)
  const roofSel = await page.evaluate(() => window.__cellSel())
  results.roof = { tileHeader: await tileHeader(page), selectedFirst: roofSel.first }
  expect(BUILDING_PARTS, 'clicking the roof cap shows a building tile').toContain(results.roof.tileHeader)

  // ── 3) BUILDING DOOR — center + click the door block ──────────────────────────────────────────────
  await page.evaluate(([c, r]) => window.__centerOn(c, r), [b.door.col, b.door.row])
  await page.waitForTimeout(300)
  pos = await page.evaluate(([c, r]) => window.__isoBlockScreen(c, r, 1), [b.door.col, b.door.row])
  await clickAt(page, pos)
  const doorSel = await page.evaluate(() => window.__cellSel())
  results.door = { doorCell: `${b.door.col},${b.door.row}`, selectedFirst: doorSel.first, tileHeader: await tileHeader(page) }
  expect(footprint.has(doorSel.first), 'clicking the door selects a building footprint cell').toBe(true)
  expect(BUILDING_PARTS, 'the door block shows a building tile').toContain(results.door.tileHeader)

  // ── 4) CHARACTER — scatter units, click one, assert the entity became the subject ─────────────────
  await page.evaluate(() => window.__scatter && window.__scatter())
  await page.waitForTimeout(500)
  const ents = await page.evaluate(() => window.__entityInfo().entities)
  results.character = { total: (ents || []).length, attempts: [] }
  for (const ent of (ents || []).slice(0, 6)) {
    await page.evaluate(() => window.__selectEntity('')) // clear selection between attempts
    // Centre the camera on the unit so its FOOT cell projects to mid-canvas (clear of the side panels), then
    // click that foot pixel — screenToCell inverts it to the unit's cell and entityAtFootprint selects it.
    await page.evaluate(([c, r]) => window.__centerOn(c, r), [ent.col, ent.row])
    await page.waitForTimeout(200)
    const pos2 = await page.evaluate(([c, r]) => window.__isoBlockScreen(c, r, 0), [ent.col, ent.row])
    if (!pos2 || pos2.x < 60 || pos2.x > 1340 || pos2.y < 60 || pos2.y > 840) continue
    await clickAt(page, pos2)
    const selEnt = await page.evaluate(() => window.__selectedEntityInfo())
    results.character.attempts.push({ clickedId: ent.id, kind: ent.kind, cell: `${ent.col},${ent.row}`, found: !!selEnt.found, selKind: selEnt.kind })
    if (selEnt.found) { results.character.selected = selEnt; break }
  }

  // ── 5) STACKED TREE — find a real tree cell, center, click it ─────────────────────────────────────
  const tree = await page.evaluate(() => window.__selectFirstTreeCell && window.__selectFirstTreeCell())
  if (tree) {
    await page.evaluate(() => window.__selectCells([])) // clear the direct-select so the CLICK is what selects
    await page.evaluate(([c, r]) => window.__centerOn(c, r), [tree.col, tree.row])
    await page.waitForTimeout(300)
    pos = await page.evaluate(([c, r]) => window.__isoBlockScreen(c, r, 0), [tree.col, tree.row])
    await clickAt(page, pos)
    const treeSel = await page.evaluate(() => window.__cellSel())
    results.tree = { treeCell: `${tree.col},${tree.row}`, selectedFirst: treeSel.first, tileHeader: await tileHeader(page) }
  } else {
    results.tree = { note: 'town produced no tree cell' }
  }

  // ── 6) BARE GROUND — a plain grass cell with nothing on it; still the FLOOR (a ground tile, NOT a building
  //    or character), i.e. no regression from the legacy flat pick. Try walkable, non-footprint cells near the
  //    settlement (so on-screen) until a click resolves to a ground-kind tile. ────────────────────────────
  const GROUND_KINDS = ['grass', 'ground', 'path', 'plaza', 'sand', 'snow', 'dirt', 'autumn', 'moss', 'cavefloor']
  const walkable = await page.evaluate(() => (window.__cellLabels(0, 0, 60, 60) || []).filter(c => !c.blocked).map(c => ({ col: c.col, row: c.row })))
  const cx = b.col, cy = b.row
  const candidatesG = walkable
    .filter(c => !footprint.has(`${c.col},${c.row}`) && c.col >= 3 && c.row >= 3)
    .sort((a, z) => (Math.abs(a.col - cx) + Math.abs(a.row - cy)) - (Math.abs(z.col - cx) + Math.abs(z.row - cy)))
  results.ground = { tried: 0 }
  for (const g of candidatesG.slice(0, 12)) {
    results.ground.tried++
    await page.evaluate(([c, r]) => window.__centerOn(c, r), [g.col, g.row])
    await page.waitForTimeout(150)
    const gp = await page.evaluate(([c, r]) => window.__isoBlockScreen(c, r, 0), [g.col, g.row])
    if (!gp || gp.x < 60 || gp.x > 1340 || gp.y < 60 || gp.y > 840) continue
    await clickAt(page, gp)
    const gsel = await page.evaluate(() => window.__cellSel())
    const glabel = await tileHeader(page)
    if (GROUND_KINDS.includes(glabel)) { results.ground = { aimedCell: `${g.col},${g.row}`, selectedFirst: gsel.first, tileHeader: glabel }; break }
  }

  results.consoleErrors = consoleErrors
  console.log('UNIFIED_PICK_PROOF ' + JSON.stringify(results, null, 2))
  // building wall + door already asserted inline (footprint cell + building-part header). Now the rest:
  expect(!!results.character.selected, 'clicking a character selects that character').toBe(true)
  expect(results.tree.tileHeader, 'clicking a tree selects the tree tile').toBe('tree')
  expect(GROUND_KINDS, 'bare ground stays the FLOOR (a ground tile), no regression').toContain(results.ground.tileHeader)
  expect(consoleErrors, 'no console errors during the whole flow').toEqual([])
})
