/**
 * Dev helper: print an ASCII preview + BALANCE STATS for a generated stage,
 * straight to the terminal (no DB, no server). Used to tune layout balance —
 * e.g. the walkable/hazard ratio of a lava-lake forest.
 *
 *   ZONE=lava VARIANT=forest LAYOUT=lake \
 *     npx ts-node --transpile-only --compiler-options '{"module":"commonjs"}' scripts/preview-stage.ts
 *
 * Legend: . walkable floor · # tree/wall · ° walkable canopy top · S spawn
 *         ~ water · I ice · ▓ lava
 */
import { generateStage, type VariantId, type ForestLayout } from '../game/engine/stageGenerator'
import { type ZoneId } from '../game/engine/zones'

const ZONE = (process.env.ZONE as ZoneId) ?? 'spring'
const VARIANT = (process.env.VARIANT as VariantId) ?? 'forest'
const LAYOUT = (process.env.LAYOUT as ForestLayout) ?? 'lake'
const COLS = Number(process.env.COLS ?? 40)
const ROWS = Number(process.env.ROWS ?? 30)

const HAZARD_GLYPH: Record<string, string> = { lava: '▓', water: '~', ice_water: 'I' }
const isHazard = (groundType: string): boolean => groundType in HAZARD_GLYPH

const stage = generateStage({ zone: ZONE, variant: VARIANT, cols: COLS, rows: ROWS, layout: LAYOUT })
const canopyTop = new Set(
  stage.props.filter(p => p.label === 'tree_leaf_top').map(p => `${p.col},${p.row}`),
)
const propGlyph = new Map<string, string>()
for (const p of stage.props) propGlyph.set(`${p.col},${p.row}`, p.char)

function glyphAt(col: number, row: number): string {
  if (col === stage.spawn.col && row === stage.spawn.row) return 'S'
  const groundType = stage.ground[row][col]
  if (isHazard(groundType)) return HAZARD_GLYPH[groundType]
  const prop = propGlyph.get(`${col},${row}`)
  if (prop) return prop // the cell's actual tileset glyph (trees ╔╦╗@♣Ψ, buildings, …)
  if (canopyTop.has(`${col},${row}`)) return '°'
  return stage.collision[row][col] ? '#' : '.'
}

// ── render the map ──
const lines: string[] = []
for (let row = 0; row < ROWS; row++) {
  let line = ''
  for (let col = 0; col < COLS; col++) line += glyphAt(col, row)
  lines.push(line)
}

// ── balance stats over the interior (exclude the solid map border) ──
let interior = 0
let walkable = 0
let hazard = 0
let land = 0 // walkable GROUND: collision-free, not hazard, not canopy-top
for (let row = 1; row < ROWS - 1; row++) {
  for (let col = 1; col < COLS - 1; col++) {
    interior++
    if (isHazard(stage.ground[row][col])) hazard++
    if (stage.collision[row][col]) continue
    walkable++
    if (!isHazard(stage.ground[row][col]) && !canopyTop.has(`${col},${row}`)) land++
  }
}

// ── walkable connectivity: flood from spawn, count reachable walkable cells ──
const reachable = new Set<string>([`${stage.spawn.col},${stage.spawn.row}`])
const stack = [stage.spawn]
const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
while (stack.length) {
  const { col, row } = stack.pop()!
  for (const [dc, dr] of dirs) {
    const c = col + dc
    const r = row + dr
    const key = `${c},${r}`
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue
    if (stage.collision[r][c] || reachable.has(key)) continue
    reachable.add(key)
    stack.push({ col: c, row: r })
  }
}

const labelCounts = new Map<string, number>()
for (const p of stage.props) {
  if (!p.label) continue
  labelCounts.set(p.label, (labelCounts.get(p.label) ?? 0) + 1)
}

const treeCells = stage.props.filter(p => p.type === 'tree').length
const pct = (n: number): string => `${((n / interior) * 100).toFixed(1)}%`
console.log(lines.join('\n'))
console.log('─'.repeat(COLS))
console.log(`zone=${ZONE} variant=${VARIANT} layout=${LAYOUT} size=${COLS}x${ROWS}`)
console.log(`interior=${interior}  walkable=${walkable} (${pct(walkable)})  land=${land} (${pct(land)})  hazard=${hazard} (${pct(hazard)})  trees=${treeCells} (${pct(treeCells)})`)
console.log(`reachable-from-spawn=${reachable.size} / walkable=${walkable}  → ${reachable.size === walkable ? 'CONNECTED ✓' : 'SPLIT ✗'}`)
console.log(
  'labels: ' +
    [...labelCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join('  '),
)
