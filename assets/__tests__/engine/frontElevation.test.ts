/**
 * 2D FRONT-ELEVATION projection (MAP-MODEL §2-3, REQUIREMENTS §1/§C).
 *
 * The 2D view is Width × Height with DEPTH collapsed. These assert the pure projection the renderer uses:
 *   - a stacked building's 2D vertical extent == its LEVEL height (not level + depth);
 *   - front-face-only: interior / back cells are hidden, the front wall / door / windows are kept;
 *   - a 1-deep tree (no depth) passes through untouched;
 *   - two buildings that share a screen column but sit in different row bands keep their OWN front rows.
 *
 * Geometry only — no canvas, no pixels.
 */
import { frontElevation } from '@/engine/render/frontElevation'
import type { GridAsset } from '@/engine/IsometricGrid'

// Minimal placed-asset factory — only the fields the projection reads.
const cell = (col: number, row: number, level: number, label: string): GridAsset =>
  ({ art: ['#'], col, row, type: 'house', label, heightLevel: level } as GridAsset)

// A house_4-shaped footprint: 4 wide (col 0-3) × 4 deep (row 0-3), 5 levels tall (0-4).
// Perimeter walls levels 0-1, windows level 2, roof levels 3-4 (gable — narrower on top), door at front
// centre level 0. The exact shape of the real house_4 composition (front row = the max row = 3).
function house4(baseCol = 0, baseRow = 0): GridAsset[] {
  const out: GridAsset[] = []
  const perim = (c: number, r: number) => c === 0 || c === 3 || r === 0 || r === 3
  // Levels 0-2: perimeter shell (wall / wall / window); the front-centre level-0 cell is the door.
  for (let level = 0; level <= 2; level++) {
    for (let r = 0; r <= 3; r++) {
      for (let c = 0; c <= 3; c++) {
        if (!perim(c, r)) continue
        const isDoor = level === 0 && r === 3 && c === 2
        out.push(cell(baseCol + c, baseRow + r, level, isDoor ? 'door' : level === 2 ? 'window' : 'wall'))
      }
    }
  }
  // Level 3: full-footprint roof. Level 4: gable cap over the centre two columns only.
  for (let r = 0; r <= 3; r++) for (let c = 0; c <= 3; c++) out.push(cell(baseCol + c, baseRow + r, 3, 'roof'))
  for (let r = 0; r <= 3; r++) for (const c of [1, 2]) out.push(cell(baseCol + c, baseRow + r, 4, 'roof'))
  return out
}

describe('frontElevation — 2D depth-collapse projection', () => {
  test('a building reads its LEVEL height, not level + depth (front wall column anchored at the front row)', () => {
    const assets = house4(0, 0)
    const { draw, hidden } = frontElevation(assets)

    // Every KEPT cell anchors at the front row (max row = 3) — the whole facade sits on one ground line,
    // so the drawn stack is exactly `maxLevel + 1` cells tall (5), NOT depth(4) + levels(5).
    for (const [, fe] of draw) expect(fe.anchorRow).toBe(3)

    // The kept cells span levels 0..4 = 5 rows of screen height (the true building height).
    const keptLevels = [...draw.keys()].map(a => a.heightLevel ?? 0)
    expect(Math.min(...keptLevels)).toBe(0)
    expect(Math.max(...keptLevels)).toBe(4)
    // With depth collapsed there is exactly one kept cell per (col, level) — no depth rows survive.
    const colLevel = new Set([...draw.keys()].map(a => `${a.col}|${a.heightLevel}`))
    expect(colLevel.size).toBe(draw.size)

    // Something behind the front face must be hidden (the collapse actually removed depth).
    expect(hidden.size).toBeGreaterThan(0)
    // Every asset is either drawn or hidden — none left ambiguous.
    expect(draw.size + hidden.size).toBe(assets.length)
  })

  test('front-face-only: the front DOOR is kept; a back-row wall in the same column/level is hidden', () => {
    const assets = house4(0, 0)
    const { draw, hidden } = frontElevation(assets)

    // Door is at (col 2, row 3, level 0) — the front-most cell in its column at level 0 → KEPT.
    const door = assets.find(a => a.label === 'door')!
    expect(draw.has(door)).toBe(true)

    // The back wall at (col 2, row 0, level 0) is behind the door → HIDDEN (not shown as a front face).
    const backWall = assets.find(a => a.col === 2 && a.row === 0 && a.heightLevel === 0)!
    expect(hidden.has(backWall)).toBe(true)

    // For a given screen column, the kept cell at each level is the MAX-row (front) one.
    for (const [a] of draw) {
      const behind = assets.filter(o => o.col === a.col && (o.heightLevel ?? 0) === (a.heightLevel ?? 0) && o.row > a.row)
      expect(behind).toHaveLength(0)
    }
  })

  test('the roof cap reads ≤3 blocks (levels 3-4) — a gable, not a depth-stacked tower', () => {
    const assets = house4(0, 0)
    const { draw } = frontElevation(assets)
    const roofLevels = new Set([...draw.keys()].filter(a => a.label === 'roof').map(a => a.heightLevel))
    expect([...roofLevels].sort()).toEqual([3, 4]) // exactly 2 roof levels survive the collapse
  })

  test('a 1-deep tree (no column depth) passes through untouched — not collapsed', () => {
    // tree footprint h=1: one row, canopy stacked in levels. No depth → nothing to collapse.
    const tree = [
      cell(5, 5, 0, 'tree_stem'),
      cell(5, 5, 1, 'tree_leaf'),
      cell(4, 5, 1, 'tree_leaf'),
      cell(6, 5, 1, 'tree_leaf'),
      cell(5, 5, 2, 'tree_top'),
    ]
    const { draw, hidden } = frontElevation(tree)
    expect(draw.size).toBe(0)   // pass-through — renderer keeps drawing each at its own row
    expect(hidden.size).toBe(0)
  })

  test('flat props (no label) are ignored entirely', () => {
    const props = [
      { art: ['#'], col: 1, row: 1, type: 'crate', heightLevel: 0 } as GridAsset,
      { art: ['#'], col: 1, row: 1, type: 'crate', heightLevel: 2 } as GridAsset,
    ]
    const { draw, hidden } = frontElevation(props)
    expect(draw.size).toBe(0)
    expect(hidden.size).toBe(0)
  })

  test('two buildings sharing a screen column but different row bands keep their OWN front rows (no merge)', () => {
    const a = house4(0, 0)   // rows 0-3, front row 3
    const b = house4(0, 10)  // same columns, rows 10-13, front row 13
    const { draw } = frontElevation([...a, ...b])

    const anchorsA = new Set([...draw.keys()].filter(x => a.includes(x)).map(x => draw.get(x)!.anchorRow))
    const anchorsB = new Set([...draw.keys()].filter(x => b.includes(x)).map(x => draw.get(x)!.anchorRow))
    expect([...anchorsA]).toEqual([3])   // building A anchored at ITS front row
    expect([...anchorsB]).toEqual([13])  // building B anchored at ITS front row — not swallowed by A
  })
})
