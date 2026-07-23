/**
 * stampRun wires a roof cell's depth-span (roof-z-width #32) onto the placed asset: it copies `settings.depth`
 * and, ROTATED by the building's rotation (rotateDepthDir), `settings.depthDir` — alongside the existing
 * scaleY/scaleX/scaleZ path. A cell with no depth is untouched (byte-identical to before). Drives the real
 * stampComposition against a minimal injected composition (a back-anchored roof column) so the wiring is
 * exercised end-to-end without needing a fresh /api/tilesets capture.
 */
import { stampComposition } from '@/game/runtime/composition'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import type { Composition } from '@/engine/tileset/tileset'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'

const SPAN_KIND = 'test_roof_span'
const PLAIN_KIND = 'test_roof_plain'

// A minimal depth-spanned roof: a house-like 3×4 footprint whose single roof column is authored at the BACK
// row (dy=0), spanning the full depth (h=4) along +row (left-down), 3 blocks tall — exactly what gable_roof emits.
const spanComposition: Composition = {
  footprint: { w: 3, h: 4 },
  cells: [{ dx: 1, dy: 0, level: 4, label: 'roof', walkable: true, settings: { depth: 4, depthDir: 'left-down', scaleY: 3 } }],
}
// A plain roof cell with NO depth — proves the depth wiring is opt-in.
const plainComposition: Composition = {
  footprint: { w: 1, h: 1 },
  cells: [{ dx: 0, dy: 0, level: 0, label: 'roof', walkable: true }],
}

describe('stampRun copies a roof cell depth-span onto the placed asset, rotated by the building rotation', () => {
  useSeedTileset() // resolveTile needs the real zone tiles for the `roof` label

  beforeAll(() => {
    ASCII_TILESET.compositions![SPAN_KIND] = spanComposition
    ASCII_TILESET.compositions![PLAIN_KIND] = plainComposition
  })

  test('rotation 0 (south): keeps the authored +row span (depth=4, depthDir=left-down) and scaleY height', () => {
    const grid = new IsometricGrid({ cols: 12, rows: 12, cellSize: 32, isoScale: 1.4 })
    const placed = stampComposition(grid, SPAN_KIND, 4, 4, 'spring', 0, 0)
    expect(placed).toBe(1)
    const roof = grid.assets.find(a => a.label === 'roof')!
    expect(roof.depth).toBe(4)
    expect(roof.depthDir).toBe('left-down')
    expect(roof.scaleY).toBe(3)
  })

  test('rotation 1 (west): rotates the span direction with the footprint (left-down → left-up), depth kept', () => {
    const grid = new IsometricGrid({ cols: 12, rows: 12, cellSize: 32, isoScale: 1.4 })
    stampComposition(grid, SPAN_KIND, 4, 4, 'spring', 0, 1)
    const roof = grid.assets.find(a => a.label === 'roof')!
    expect(roof.depth).toBe(4)
    expect(roof.depthDir).toBe('left-up') // spans −col now — no sideways roof on an east/west building
    expect(roof.scaleY).toBe(3)
  })

  test('rotation 3 (east): span direction follows to +col (left-down → right-down)', () => {
    const grid = new IsometricGrid({ cols: 12, rows: 12, cellSize: 32, isoScale: 1.4 })
    stampComposition(grid, SPAN_KIND, 4, 4, 'spring', 0, 3)
    const roof = grid.assets.find(a => a.label === 'roof')!
    expect(roof.depthDir).toBe('right-down')
  })

  test('a cell with NO depth is untouched — no depth/depthDir on the placed asset (byte-identical to before)', () => {
    const grid = new IsometricGrid({ cols: 6, rows: 6, cellSize: 32, isoScale: 1.4 })
    stampComposition(grid, PLAIN_KIND, 2, 2, 'spring')
    const a = grid.assets.find(x => x.label === 'roof')!
    expect(a.depth).toBeUndefined()
    expect(a.depthDir).toBeUndefined()
  })
})
