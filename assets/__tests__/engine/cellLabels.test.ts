import {
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

// PER-LABEL COLLISION IS GONE, and so is the group that tested it.
//
// `isWalkable(label)` was removed from `cellLabels.ts` on 2026-09-06, and its own note says why: it
// hardcoded a walkability table in the frontend, it claimed a ROOF was walkable (which the combat spec
// forbids — Alexander: *"roof should have collissions"*), and it duplicated data the backend already owns
// and serves as `tiles.blocking` and `composition_cells.walkable`. It had no runtime callers.
//
// So there is nothing here to re-point at: the question "is this label walkable?" is not one the frontend
// answers any more. Collision now rides on the placed tile, is per-view, and is covered by the collision
// and composition suites. `isGroundContact`, `autotileLabel` and `TREE_MASS_FAMILY` are still real and
// still tested above.

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
