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
import { makeBuilding, buildingFootprintCells } from '@/engine/buildingEditor'
import { IsometricGrid } from '@/engine/IsometricGrid'
import type { Facing } from '@/engine/villageLayout'
import { stampBuildingCells } from '@/game/runtime/buildings'

const FACINGS: Facing[] = ['south', 'north', 'east', 'west']

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
