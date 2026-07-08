/**
 * #82 — 2D building wall collisions.
 *
 * Two guarantees, both proven here for EVERY facing (south/north/east/west):
 *   A. GRID-LEVEL (the collision invariant): the live stamp blocks every footprint
 *      wall cell and leaves exactly the single road-edge door cell walkable.
 *   B. RENDER-ALIGNMENT (the actual #82 fix): the 2D front elevation draws a wall
 *      ONLY over footprint columns — never a phantom column past the footprint that
 *      has no collision behind it (the east/west walk-through-wall bug).
 */
import { draw2DBuilding } from '@/engine/render/topdown'
import { makeBuilding, buildingFootprintCells, buildingDoorCell, buildingRect, resizeBuilding } from '@/engine/buildingEditor'
import { IsometricGrid } from '@/engine/IsometricGrid'
import type { Facing } from '@/engine/villageLayout'
import { stampBuildingCells } from '@/game/runtime/buildings'

const FACINGS: Facing[] = ['south', 'north', 'east', 'west']

// #A — the 2D DRAWN door must land on the walkable/collision door cell. In the axis-aligned (south/north)
// identity path, draw2DBuilding paints the facade's own 'door' column straight onto grid column b.col + i,
// so the facade door column must equal doorCellFor's walkable column. This broke on EVEN frontages (the
// facade door sat one column left of the walkable cell → "door not at the entrance, collision doesn't match").
describe('#A — 2D drawn door column lands on the walkable door cell (both views agree)', () => {
  for (const len of [4, 5, 6, 8]) { // include EVEN frontages (the bug was even-only)
    for (const facing of ['south', 'north'] as Facing[]) {
      test(`${facing} len=${len}: facade door column == walkable/collision door cell`, () => {
        const b = resizeBuilding(makeBuilding('house', facing, 20, 20), len)
        const bottom = b.cells[b.cells.length - 1]
        const facadeDoorX = bottom.indexOf('door') // the column draw2DBuilding paints the door on (identity path)
        const door = buildingDoorCell(b) // = doorCellFor = the walkable cell stampBuildingCells opens
        const rect = buildingRect(b)
        expect(facadeDoorX).toBeGreaterThanOrEqual(0)
        expect(b.col + facadeDoorX).toBe(door.col) // drawn door column == walkable door column
        expect(door.row).toBe(facing === 'south' ? rect.row + rect.h - 1 : rect.row) // on the road edge

        // …and that cell is exactly the one the live stamp leaves walkable.
        const grid = new IsometricGrid({ cols: 40, rows: 40, cellSize: 16, isoScale: 1 })
        stampBuildingCells(grid, b, 'spring')
        expect(grid.collision[door.row][door.col]).toBe(0)
      })
    }
  }
})

describe('#82 A — grid-level: stamped wall cells block, the door stays walkable', () => {
  for (const facing of FACINGS) {
    test(`${facing}: every footprint cell blocks except the single door`, () => {
      const grid = new IsometricGrid({ cols: 40, rows: 40, cellSize: 16, isoScale: 1 })
      const b = makeBuilding('house', facing, 20, 20)
      stampBuildingCells(grid, b, 'spring')

      const { cells, door } = buildingFootprintCells(b)
      // The door cell is walkable…
      expect(grid.collision[door.row][door.col]).toBe(0)
      // …and every OTHER footprint cell is blocked.
      const walls = cells.filter(c => !(c.col === door.col && c.row === door.row))
      for (const c of walls) {
        expect(grid.collision[c.row][c.col]).toBe(1)
      }
      // Exactly one walkable cell in the footprint.
      const walkable = cells.filter(c => grid.collision[c.row][c.col] === 0)
      expect(walkable).toEqual([door])
    })
  }
})

// A canvas ctx mock that records the cell-background rects draw2DBuilding paints.
function recordingCtx() {
  const rects: { x: number; y: number; w: number; h: number }[] = []
  const ctx = {
    fillStyle: '#000',
    font: '',
    textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline,
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h })
    },
    fillText() {},
    measureText() {
      return { width: 10 } as TextMetrics
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects }
}

describe('#82 B — render: 2D walls are drawn ONLY on footprint columns (no walk-through wall)', () => {
  const tileW = 10
  const tileH = 10

  for (const facing of FACINGS) {
    test(`${facing}: drawn elevation columns == the footprint columns`, () => {
      const b = makeBuilding('house', facing, 20, 20)
      // render2D anchors the facade centre at grid-x (b.col + b.length/2); with 1 cell == tileW px
      // and the grid origin at 0, that is this centerX. (baseY is irrelevant to column placement.)
      const centerX = (b.col + b.length / 2) * tileW
      const { ctx, rects } = recordingCtx()
      draw2DBuilding(ctx, b, centerX, 100, tileW, tileH, 1)

      // Cell backgrounds are the full-tile rects; their left edge maps back to a grid column.
      const drawnCols = new Set(
        rects
          .filter(r => r.w === tileW && r.h === tileH)
          .map(r => Math.round(r.x / tileW)),
      )
      const footCols = new Set(buildingFootprintCells(b).cells.map(c => c.col))

      // Every drawn column is a real footprint column — the east/west bug drew one PAST it.
      for (const col of drawnCols) {
        expect(footCols.has(col)).toBe(true)
      }
      // And the elevation covers the whole footprint width (no missing columns either).
      expect([...drawnCols].sort((a, z) => a - z)).toEqual([...footCols].sort((a, z) => a - z))
    })
  }
})
