/**
 * THE LAWS, AS A GATE.
 *
 * Compliance with docs/SPEC.md is mandatory, expected and implied, and that is exactly why it cannot
 * live in somebody's memory. This checks the laws that can be checked mechanically, against the
 * schema the backend actually serves, so a drift fails here instead of being noticed months later.
 *
 * LAW 1  A second vocabulary whose whole job is to be translated back is not a concept.
 *        Every field the engine carries on a placed tile is either a COLUMN, spelled the way the
 *        column is spelled, or is on the list below with a reason. `scaleX` and `scaleY` were exactly
 *        this: Width and Height under other names, translated at every boundary.
 *
 * LAW 12 The frontend sets no limits. No minimum, no maximum, no step invented in React.
 *
 * Both are read from the source and from /api/maps/schema, never from a copy.
 *
 *   bin/e2e specCompliance        (via bin/e2e)
 */
import { readFileSync } from 'node:fs'
import { BASE } from './base.mjs'
import { chromium } from 'playwright'
import { logIn } from './logIn.mjs'

/**
 * Fields the ENGINE carries that are deliberately not columns, each with the reason.
 *
 * A name may only sit here because it is not a setting at all, or because the spec puts it in another
 * table in a later phase. "It is convenient" is not a reason, and neither is "it already existed".
 */
const ENGINE_ONLY = {
  art: 'the glyph rows a tile draws with, resolved from the tileset, never authored on a placement',
  col: 'where the tile is. The cell owns it, and a cell_tile hangs off the cell',
  row: 'where the tile is. The cell owns it',
  type: 'the discriminator the stack helpers read. tiles.category in the schema',
  label: 'what the tile draws as. The engine resolves BY label; the column is the resolved tile_id',
  tileKey: 'the same question as label, kept while both spellings are still read',
  tileOverride: 'a per-cell art pin. tiles.autotile_slot territory, phase 7',
  heightLevel: 'which level the tile sits on. cell_tiles.stack_level',
  zIndex: 'cell_tiles.draw_order',
  zOffset: 'cell_tiles.slide_amount',
  zDir: 'cell_tiles.slide_direction',
  spanForward: 'cell_tiles.span_forward',
  spanBack: 'cell_tiles.span_back',
  spanPerp: 'cell_tiles.span_perp',
  spanPerpBack: 'cell_tiles.span_perp_back',
  spanAxis: 'cell_tiles.span_axis',
  sideColor: 'cell_tiles.side_color',
  bgColor: 'cell_tiles.bg_color',
  pose: 'nudge_x, nudge_y, rotation, mirror, art_scale and muzzle, as one object in the engine',
  thickness: 'the four thickness_* reaches, as one object in the engine',
  flow: 'cell_tiles.water_heading, as a quarter turn rather than a compass point',
  settings: 'display, transparent, fade_near, cutaway_near, min_alpha, act_as_tile and the badge',
  animations: 'phase 6, the animation tables',
  cycles: 'phase 6, the animation tables',
  cellAnim: 'phase 6, the animation tables',
  placedAt: 'phase 6: when a tile was placed, which is what an animation delay is measured from',
  light: 'phase 6, the lights table',
  baseShadow: 'DELETED by §9. Shadows come from the sun, not a flag. Still read while it is removed',
  buildingType: 'building_templates.key, phase 8',
  edge: 'tiles.autotile_slot, phase 7',
  cellPart: 'tiles.autotile_slot, phase 7. Debug labels only, it touches no renderer',
  footprint: 'compositions, phase 7',
}

const browser = await chromium.launch()
const page = await browser.newPage()

const failures = []
const check = (passed, what, detail = '') => {
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? '  ' + detail : ''}`)
  if (!passed) failures.push(what)
}

await logIn(page, BASE)

const schema = await page.evaluate(async (base) => {
  const res = await fetch(`${base}/api/maps/schema`)
  return res.ok ? (await res.json()).data : null
}, BASE)

if (!schema) {
  console.error('FAIL  /api/maps/schema did not answer, so there is nothing to check against')
  await browser.close()
  process.exit(1)
}

const columns = new Set(schema.fields)
const snake = (name) => name.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())

// ── LAW 1 ──────────────────────────────────────────────────────────────────────────────────────
const source = readFileSync(new URL('../game/engine/IsometricGrid.ts', import.meta.url), 'utf8')
const body = source.slice(source.indexOf('export interface GridAsset {'))
const fields = [...body.slice(0, body.indexOf('\n}')).matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1])

check(fields.length > 20, 'the GridAsset interface was parsed', `${fields.length} fields`)

const unexplained = fields.filter((f) => !columns.has(f) && !columns.has(snake(f)) && !(f in ENGINE_ONLY))
check(
  unexplained.length === 0,
  'every field the engine carries is a column, or is listed with a reason',
  unexplained.length ? `unexplained: ${unexplained.join(', ')}` : `${fields.length} fields`,
)

// The two that started this, by name, so they cannot come back quietly.
for (const gone of ['scale', 'scaleX', 'scaleY', 'scaleZ']) {
  check(!fields.includes(gone), `${gone} is not a field on a placed tile`)
}

// ── LAW 12 ─────────────────────────────────────────────────────────────────────────────────────
//
// The property is not "no numbers appear near a slider". A slider needs a range to drag within, and
// the compliant shape is `dragRange(value, from, to)`, which returns Math.min(from, value) and
// Math.max(to, value): the window follows the value and never caps it, and the number field beside it
// takes anything. So what is checked is that EVERY range input gets its bounds that way.
const inspector = readFileSync(new URL('../game/components/editorInspector.tsx', import.meta.url), 'utf8')
const ranges = [...inspector.matchAll(/<input type="range"[^>]*>/g)].map((m) => m[0])

check(ranges.length > 0, 'the inspector was parsed', `${ranges.length} sliders`)

const capped = ranges.filter((tag) => !tag.includes('dragRange') && !/\bmin=\{drag\.min\}/.test(tag))
check(
  capped.length === 0,
  'every slider takes its bounds from dragRange, so none of them caps a value',
  capped.length ? capped.map((t) => t.slice(0, 70)).join(' | ') : `${ranges.length} sliders`,
)

// And dragRange itself has to be the thing that grows, or the check above proves nothing.
check(
  /Math\.min\(min, value\)/.test(inspector) && /Math\.max\(max, value\)/.test(inspector),
  'dragRange grows to hold the value rather than clamping it',
)

await browser.close()
console.log(failures.length ? `\n${failures.length} LAW(S) BROKEN` : '\nPASS  the laws that can be checked, hold')
process.exit(failures.length ? 1 : 0)
