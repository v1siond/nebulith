/**
 * REALISTIC SAMPLE COMPOSITIONS — the window-grid / storefront / flat-roof / fountain / tree-trunk rules
 * asserted END-TO-END on the loaded backend tileset (the captured `/api/tilesets` fixture = the nebulith
 * source of truth). These prove the DATA the app renders from, not pixels: THE realism rule is that windows
 * form a SPACED GRID (window, wall, window …), vertically aligned across floors — never a solid band.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { resolveComposition } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'

type Cell = { dx: number; dy: number; level: number; label: string }
const comp = (name: string) => resolveComposition(ASCII_TILESET, name)!

// The FRONT face (max-dy row wins) label at each (dx, level) — what the 2D front elevation reads.
function frontLabel(cells: Cell[], dx: number, level: number): string | null {
  const at = cells.filter(c => c.dx === dx && c.level === level)
  if (at.length === 0) return null
  return at.reduce((a, b) => (b.dy > a.dy ? b : a)).label
}
const isWindow = (l: string | null) => l != null && l.startsWith('window')
const isWall = (l: string | null) => l != null && l.startsWith('wall')

describe('sample compositions — realistic building/fountain/tree DATA from the backend', () => {
  describe('THE window-grid rule: windows are SPACED + vertically aligned, never a solid band', () => {
    for (const name of ['house_3', 'house_4', 'house_5', 'office_5']) {
      test(`${name}: window columns are spaced (no two adjacent) and aligned across floors`, () => {
        const c = comp(name)
        const w = c.footprint.w
        const cells = c.cells as Cell[]
        const levels = [...new Set(cells.map(x => x.level))].sort((a, b) => a - b)

        // The window LEVELS (floors that carry any front window).
        const windowLevels = levels.filter(lv => Array.from({ length: w }, (_, dx) => frontLabel(cells, dx, lv)).some(isWindow))
        expect(windowLevels.length).toBeGreaterThanOrEqual(2) // multiple floors have windows

        const windowColsAt = (lv: number) =>
          Array.from({ length: w }, (_, dx) => dx).filter(dx => isWindow(frontLabel(cells, dx, lv)))

        for (const lv of windowLevels) {
          const cols = windowColsAt(lv)
          // NOT a solid band — at least one non-window column sits between windows on this floor.
          expect(cols.length).toBeLessThan(w)
          // SPACED — no two window columns are adjacent (a wall pier separates them).
          for (let i = 1; i < cols.length; i++) expect(cols[i] - cols[i - 1]).toBeGreaterThanOrEqual(2)
        }

        // ALIGNED — every window sits in the SAME vertical columns (a window above a window). The
        // topmost floor carries the full set; lower floors are a subset (the ground floor's centred
        // door replaces the window in the door column), never a window in a NEW/wandering column.
        const topCols = windowColsAt(windowLevels[windowLevels.length - 1])
        expect(topCols.length).toBeGreaterThanOrEqual(1)
        for (const lv of windowLevels) expect(windowColsAt(lv).every(dx => topCols.includes(dx))).toBe(true)

        // WALL BETWEEN FLOORS — between two window floors there is a level with walls in those columns.
        for (let i = 1; i < windowLevels.length; i++) {
          const between = windowLevels[i - 1] + 1
          expect(topCols.every(dx => isWall(frontLabel(cells, dx, between)))).toBe(true)
        }
      })
    }
  })

  test('store: a storefront — wide display window + centred door + a striped awning above, flat roof', () => {
    const c = comp('store_5')
    const cells = c.cells as Cell[]
    const w = c.footprint.w
    const doorCol = Math.floor(w / 2)
    // Ground front (level 0): display windows flanking a centred door.
    expect(frontLabel(cells, doorCol, 0)).toBe('door')
    const groundGlass = Array.from({ length: w }, (_, dx) => dx).filter(dx => dx !== doorCol && frontLabel(cells, dx, 0) === 'display_window')
    expect(groundGlass.length).toBeGreaterThanOrEqual(2) // a WIDE storefront (≥2 display-window cells)
    // Awning band directly ABOVE the storefront (level 1), over the display windows.
    expect(groundGlass.every(dx => frontLabel(cells, dx, 1) === 'awning')).toBe(true)
    // FLAT roof (parapet), not a gable, and a blue "Store" sign (roof_top_store) as the badge anchor.
    const labels = new Set(cells.map(x => x.label))
    expect(labels.has('parapet')).toBe(true)
    expect(labels.has('roof_top_store')).toBe(true)
    expect([...labels].some(l => l === 'roof' || l === 'roof_store')).toBe(false) // no gable roof
  })

  test('office: taller than a house, flat roof + a rooftop unit, regular window grid every floor', () => {
    const c = comp('office_5')
    const cells = c.cells as Cell[]
    const maxLevel = Math.max(...cells.map(x => x.level))
    expect(maxLevel).toBeGreaterThan(Math.max(...comp('house_4').cells.map(x => x.level))) // taller than a house
    const labels = new Set(cells.map(x => x.label))
    expect(labels.has('flat_roof')).toBe(true)
    expect(labels.has('parapet')).toBe(true)
    expect(labels.has('rooftop_unit')).toBe(true)
    expect(labels.has('roof')).toBe(false) // flat, not gable
  })

  test('fountain: a composition — stone rim perimeter, water floor, raised jets', () => {
    const c = comp('fountain')
    const cells = c.cells as Cell[]
    const { w, h } = c.footprint
    expect(w).toBe(5)
    expect(h).toBe(4)
    const edge = (dx: number, dy: number) => dx === 0 || dx === w - 1 || dy === 0 || dy === h - 1
    // Perimeter = stone_rim; interior floor (level 0) = water.
    for (const cell of cells.filter(x => x.level === 0)) {
      expect(cell.label).toBe(edge(cell.dx, cell.dy) ? 'stone_rim' : 'fountain_water')
    }
    // A few water jets RAISED above the floor (level ≥ 1).
    const jets = cells.filter(x => x.label === 'water_jet')
    expect(jets.length).toBeGreaterThanOrEqual(1)
    expect(jets.every(j => j.level >= 1)).toBe(true)
  })

  test('tree: a distinct brown trunk at the base (level 0) with the canopy stacked above', () => {
    const cells = comp('tree').cells as Cell[]
    const base = cells.filter(x => x.level === 0)
    expect(base.length).toBeGreaterThanOrEqual(1)
    expect(base.every(x => x.label.startsWith('trunk'))).toBe(true) // the base is a TRUNK, not a leaf
    const canopy = cells.filter(x => x.level >= 1)
    expect(canopy.length).toBeGreaterThan(0)
    expect(canopy.every(x => x.label.startsWith('leaf'))).toBe(true) // leaves stack ABOVE the trunk
    // The bush, by contrast, is trunkless (a low leaf mound) — trunks are a TREE thing.
    expect((comp('bush').cells as Cell[]).some(x => x.label.startsWith('trunk'))).toBe(false)
  })
})
