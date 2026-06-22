import {
  CELL_LABELS,
  isWalkable,
  labelChar,
  autotileLabel,
  TREE_MASS_FAMILY,
  type CellLabel,
} from '@/engine/cellLabels'

describe('cellLabels — per-label collision (isWalkable)', () => {
  it('makes only tree_leaf_top walkable among tree parts', () => {
    expect(isWalkable('tree_leaf_top')).toBe(true)
    const blockingTreeParts: CellLabel[] = ['tree_stem_bottom', 'tree_stem', 'tree_leaf']
    for (const label of blockingTreeParts) {
      expect(isWalkable(label)).toBe(false)
    }
  })

  it('blocks every 9-piece tree-mass cell (canopy is solid)', () => {
    const massLabels: CellLabel[] = [
      'tree_top_left',
      'tree_top',
      'tree_top_right',
      'tree_edge_left',
      'tree_interior',
      'tree_edge_right',
      'tree_bottom_left',
      'tree_bottom',
      'tree_bottom_right',
    ]
    for (const label of massLabels) {
      expect(isWalkable(label)).toBe(false)
    }
  })

  it('makes only the top roof tile and doors walkable among building parts', () => {
    expect(isWalkable('roof_top')).toBe(true)
    expect(isWalkable('door')).toBe(true)
    const blockingBuildingParts: CellLabel[] = ['roof', 'wall', 'window']
    for (const label of blockingBuildingParts) {
      expect(isWalkable(label)).toBe(false)
    }
  })

  it('treats an unknown label as blocking (fail-safe collision)', () => {
    expect(isWalkable('totally_unknown_label')).toBe(false)
  })
})

describe('cellLabels — labelChar render glyphs', () => {
  it('maps every known label to a non-empty single glyph', () => {
    for (const label of CELL_LABELS) {
      const glyph = labelChar(label)
      expect(typeof glyph).toBe('string')
      expect(glyph.length).toBeGreaterThan(0)
    }
  })

  it('distinguishes the walkable canopy top from solid leaves', () => {
    expect(labelChar('tree_leaf_top')).not.toBe(labelChar('tree_leaf'))
  })
})

describe('cellLabels — autotile labeler (9-piece, 8-neighbour)', () => {
  // 3×3 solid block: the center is interior, corners/edges are the 9 pieces.
  const cols = 3
  const rows = 3
  const filled = (col: number, row: number): boolean =>
    col >= 0 && col < cols && row >= 0 && row < rows

  it('labels each cell of a 3×3 mass by its edge/corner/interior position', () => {
    const at = (col: number, row: number) => autotileLabel(TREE_MASS_FAMILY, filled, col, row)
    expect(at(0, 0)).toBe('tree_top_left')
    expect(at(1, 0)).toBe('tree_top')
    expect(at(2, 0)).toBe('tree_top_right')
    expect(at(0, 1)).toBe('tree_edge_left')
    expect(at(1, 1)).toBe('tree_interior')
    expect(at(2, 1)).toBe('tree_edge_right')
    expect(at(0, 2)).toBe('tree_bottom_left')
    expect(at(1, 2)).toBe('tree_bottom')
    expect(at(2, 2)).toBe('tree_bottom_right')
  })

  it('labels a lone filled cell as a four-sided corner (all-edges → interior fallback aside)', () => {
    const lone = (col: number, row: number): boolean => col === 5 && row === 5
    // open on every side: top+left open ⇒ top-left corner piece.
    expect(autotileLabel(TREE_MASS_FAMILY, lone, 5, 5)).toBe('tree_top_left')
  })

  it('only the 5×5-interior cell of a 5×5 mass is fully interior', () => {
    const big = (col: number, row: number): boolean =>
      col >= 0 && col < 5 && row >= 0 && row < 5
    expect(autotileLabel(TREE_MASS_FAMILY, big, 2, 2)).toBe('tree_interior')
    // a cell on the top edge (open above) is never interior
    expect(autotileLabel(TREE_MASS_FAMILY, big, 2, 0)).toBe('tree_top')
  })
})
