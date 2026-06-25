import {
  isWalkable,
  autotileLabel,
  isGroundContact,
  TREE_MASS_FAMILY,
  type CellLabel,
} from '@/engine/cellLabels'

describe('isGroundContact — only the BOTTOM cell of a tree/column (where the shadow goes)', () => {
  // A vertical tree occupying rows 3,4,5 at col 2 (5 is the bottom / ground contact).
  const tree = (col: number, row: number): boolean => col === 2 && row >= 3 && row <= 5

  it('is true ONLY for the bottom cell (cell below is not a tree)', () => {
    expect(isGroundContact(tree, 2, 5)).toBe(true) // bottom — floor below
    expect(isGroundContact(tree, 2, 4)).toBe(false) // tree below it
    expect(isGroundContact(tree, 2, 3)).toBe(false) // tree below it (the top/canopy)
  })

  it('is false for an empty cell', () => {
    expect(isGroundContact(tree, 7, 7)).toBe(false)
  })

  it('a 1-cell tree is its own ground contact', () => {
    const lone = (c: number, r: number) => c === 1 && r === 1
    expect(isGroundContact(lone, 1, 1)).toBe(true)
  })
})

describe('cellLabels — per-label collision (isWalkable)', () => {
  it('blocks all solid tree parts (only the reserved tree_leaf_top stays walkable)', () => {
    // tree_leaf_top remains walkable in the vocabulary for a FUTURE overhead-canopy
    // layer, but the generator no longer emits it — glade trees are capped by a
    // SOLID tree_crown so the whole tree blocks.
    expect(isWalkable('tree_leaf_top')).toBe(true)
    const blockingTreeParts: CellLabel[] = ['tree_stem_bottom', 'tree_stem', 'tree_leaf', 'tree_crown', 'tree_snag']
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

  it('makes ONLY the top roof tile walkable among building parts (buildings are solid)', () => {
    expect(isWalkable('roof_top')).toBe(true)
    // doors block too now — a building is solid like a tree until interiors arrive
    const blockingBuildingParts: CellLabel[] = ['roof', 'wall', 'window', 'door']
    for (const label of blockingBuildingParts) {
      expect(isWalkable(label)).toBe(false)
    }
  })

  it('treats an unknown label as blocking (fail-safe collision)', () => {
    expect(isWalkable('totally_unknown_label')).toBe(false)
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
