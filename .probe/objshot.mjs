/**
 * OBJECT SHOT: render ONE object on open ground and crop it, so a design can be compared against its
 * reference picture side by side. Two sources, one render path:
 *   SPEC=<file.json>  build the object live from a cell list (a PROPOSAL, nothing seeded)
 *   COMP=<key>        stamp a SEEDED composition by its catalogue key (what the DB serves today)
 * The live build mirrors compositionCellRender exactly (height 1, heightLevel = level, scale/scaleY/... from
 * settings), so what it draws is what the same cells would draw once seeded.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

const OUT = process.env.OUT || '/tmp/objshots'
const NAME = process.env.NAME || 'object'
const PRESET = process.env.PRESET || 'Meadow'
const VIEW = process.env.VIEW || 'iso'
const PAD = Number(process.env.PAD || 3)
const FP = process.env.FP ? { w: Number(process.env.FP.split('x')[0]), h: Number(process.env.FP.split('x')[1]) } : null
mkdirSync(OUT, { recursive: true })

const spec = process.env.SPEC ? JSON.parse(readFileSync(process.env.SPEC, 'utf8')) : null
const comp = process.env.COMP || null

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(4000)

await p.getByRole('button', { name: new RegExp('^' + PRESET) }).first().click().catch(() => {})
await p.waitForTimeout(400)
await p.evaluate(() => { let t = 11; Math.random = () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })
await p.getByRole('button', { name: /Build this world/ }).click()
await p.waitForTimeout(4000)
for (let i = 0; i < 6; i++) { const x = p.locator('button', { hasText: /^✕$/ }).first(); if (await x.count().catch(() => 0)) { await x.click().catch(() => {}); await p.waitForTimeout(200) } else break }
await p.keyboard.press('Escape').catch(() => {})
await p.waitForTimeout(400)

const placed = await p.evaluate(([spec, comp, PAD, fp, channel]) => {
  const g = globalThis.__nebulithGrid
  if (!g) return { error: 'no grid' }
  let w = spec ? spec.footprint.w : 6
  let h = spec ? spec.footprint.h : 6
  if (comp && fp) { w = fp.w; h = fp.h }
  const c0 = Math.max(2, Math.floor(g.cols / 2) - Math.floor(w / 2))
  const r0 = Math.max(2, Math.floor(g.rows / 2) - Math.floor(h / 2))
  // OPEN GROUND. The object is being judged on its own silhouette, so nothing else may stand in the crop.
  for (let c = c0 - PAD; c <= c0 + w + PAD; c++)
    for (let r = r0 - PAD; r <= r0 + h + PAD; r++) {
      const list = g.getAssetsAtCell?.(c, r) ?? []
      for (const a of list) if (a.type !== 'floor') g.removeAsset?.(a) ?? (g.assets = g.assets.filter(x => x !== a))
      g.setCollision?.(c, r, false)
    }
  // CUT THE CHANNEL the object actually lives over, when asked (CHANNEL=<cells>).
  //
  // A bridge's defining feature is the hole under it, and on flat ground that hole is UNDERGROUND: the level
  // -1 void is buried, so four iterations of arch tuning were judged against a picture that could not show an
  // arch. The strip is cut across the middle of the span, which is where a river runs.
  if (channel > 0) {
    const from = c0 + Math.floor((w - channel) / 2)
    // ONLY THE OBJECT'S OWN ROWS. Running the cut out past them put the far bank in the foreground, where it
    // stood a block proud of everything and drew straight over the thing being judged.
    for (let c = from; c < from + channel; c++)
      for (let r = r0; r < r0 + h; r++) {
        g.setGround?.(c, r, 'water')
        g.setHeight?.(c, r, -1)
      }
  }
  if (comp) { const n = globalThis.__placeComposition(comp, c0, r0); return { c0, r0, w, h, n, mode: 'comp' } }
  for (const cell of spec.cells) {
    const s = cell.settings || {}
    const a = g.placeAsset([''], c0 + cell.dx, r0 + cell.dy, { type: spec.name, color: s.color ?? cell.tileColor, blocking: !cell.walkable })
    a.label = cell.label
    a.height = 1
    a.heightLevel = cell.level ?? 0
    a.scale = cell.scale ?? 1
    a.scaleX = s.scaleX; a.scaleY = s.scaleY; a.scaleZ = s.scaleZ
    a.depth = s.depth; a.depthDir = s.depthDir; a.depthBack = s.depthBack
    a.depthPerp = s.depthPerp; a.depthPerpBack = s.depthPerpBack
    // THICKNESS: mirror tileThicknessReach — the {scaleZ, thicknessDir} shorthand expands to a reach map
    // on the OPPOSITE direction, and an explicit map wins. Without this a cell's thicknessDir does nothing.
    const OPP = { 'left-up': 'right-down', 'right-down': 'left-up', 'right-up': 'left-down', 'left-down': 'right-up' }
    let reach = s.thickness ? { ...s.thickness } : undefined
    if (s.thicknessDir && typeof s.scaleZ === 'number' && s.scaleZ > 0 && s.scaleZ < 1) {
      reach = reach || {}
      const back = OPP[s.thicknessDir]
      if (reach[back] === undefined) reach[back] = s.scaleZ
    }
    a.thickness = reach; a.pose = s.pose; a.shape = s.shape; a.light = s.light
    a.zIndex = cell.zIndex
    const set = {}
    if (s.display) set.display = s.display
    if (s.transparent) set.transparent = s.transparent
    if (Object.keys(set).length) a.settings = set
  }
  return { c0, r0, w, h, n: spec.cells.length, mode: 'spec' }
}, [spec, comp, PAD, FP, Number(process.env.CHANNEL || 0)])
console.log('placed:', JSON.stringify(placed))
if (placed.error || placed.n === 0) { console.log('NOTHING PLACED'); await b.close(); process.exit(1) }

await p.evaluate(v => globalThis.__setView?.(v), VIEW)
const cbx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(cbx.x + cbx.width / 2, cbx.y + cbx.height / 2)
for (let i = 0; i < Number(process.env.ZOOM || 6); i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(90) }
await p.waitForTimeout(400)
await p.evaluate(([c, r, away]) => { globalThis.__setHero?.(c + away, r + away); globalThis.__centerOn?.(c, r) }, [placed.c0 + Math.floor(placed.w / 2), placed.r0 + Math.floor(placed.h / 2), Number(process.env.HEROAWAY || 6)])
await p.waitForTimeout(1200)

const box = await p.evaluate(([c0, r0, w, h, S]) => {
  const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  const pr = globalThis.__nebulithProject
  if (!pr) return null
  const rect = cv.getBoundingClientRect()
  const sx = rect.width / cv.width, sy = rect.height / cv.height
  const mid = pr.toScreen(c0 + (w - 1) / 2, r0 + (h - 1) / 2)
  // the crop sits a little ABOVE the footprint centre: whatever the object stands up is drawn upward from it
  const cx = rect.left + mid.x * sx, cy = rect.top + mid.y * sy - S * 0.18
  return { x: cx - S / 2, y: cy - S / 2, width: S, height: S }
}, [placed.c0, placed.r0, placed.w, placed.h, Number(process.env.SIZE || 620)])
if (!box) { console.log('NO PROJECTION'); await b.close(); process.exit(1) }
const vp = p.viewportSize()
const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, vp.width - Math.max(0, box.x)), height: Math.min(box.height, vp.height - Math.max(0, box.y)) }
await p.screenshot({ path: `${OUT}/${NAME}.png`, clip })
console.log('WROTE', `${OUT}/${NAME}.png`, JSON.stringify(clip))
await b.close()
