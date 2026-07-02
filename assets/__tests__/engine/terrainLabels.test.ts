import { terrainLabelAt, terrainCaptions } from '@/engine/terrainLabels'

// A 3×3 grass field surrounded by a path border — the canonical autotile case: interior fill,
// straight edges, and corners, all keyed off which orthogonal neighbours are a DIFFERENT terrain.
const ground = [
  ['path', 'path', 'path', 'path', 'path'],
  ['path', 'grass', 'grass', 'grass', 'path'],
  ['path', 'grass', 'grass', 'grass', 'path'],
  ['path', 'grass', 'grass', 'grass', 'path'],
  ['path', 'path', 'path', 'path', 'path'],
]

describe('terrainLabelAt — every ground cell autotiles to <TERRAIN> <POSITION>', () => {
  it('a fully-surrounded grass cell is GRASS INTERIOR', () => {
    expect(terrainLabelAt(ground, 2, 2)).toBe('GRASS INTERIOR')
  })

  it('a grass cell bordering path on one side is that EDGE', () => {
    expect(terrainLabelAt(ground, 2, 1)).toBe('GRASS TOP') // path above
    expect(terrainLabelAt(ground, 2, 3)).toBe('GRASS BOTTOM') // path below
    expect(terrainLabelAt(ground, 1, 2)).toBe('GRASS LEFT') // path left
    expect(terrainLabelAt(ground, 3, 2)).toBe('GRASS RIGHT') // path right
  })

  it('a grass cell bordering path on two orthogonal sides is that CORNER', () => {
    expect(terrainLabelAt(ground, 1, 1)).toBe('GRASS TOP-LEFT')
    expect(terrainLabelAt(ground, 3, 1)).toBe('GRASS TOP-RIGHT')
    expect(terrainLabelAt(ground, 1, 3)).toBe('GRASS BOTTOM-LEFT')
    expect(terrainLabelAt(ground, 3, 3)).toBe('GRASS BOTTOM-RIGHT')
  })

  it('the path cells carry their OWN terrain type, not grass', () => {
    expect(terrainLabelAt(ground, 0, 0)).toMatch(/^PATH /)
  })

  it('the grid EDGE counts as an open side (out-of-bounds ≠ same terrain)', () => {
    // an all-grass 3×3: the map border makes the rim cells edge/corner pieces, centre INTERIOR.
    const field = [['grass', 'grass', 'grass'], ['grass', 'grass', 'grass'], ['grass', 'grass', 'grass']]
    expect(terrainLabelAt(field, 1, 1)).toBe('GRASS INTERIOR') // fully enclosed
    expect(terrainLabelAt(field, 1, 0)).toBe('GRASS TOP') // top border open
    expect(terrainLabelAt(field, 0, 1)).toBe('GRASS LEFT') // left border open
    expect(terrainLabelAt(field, 0, 0)).toBe('GRASS TOP-LEFT') // corner: top + left open
  })

  it('terrainCaptions labels EVERY cell (no ground cell left unlabeled)', () => {
    const caps = terrainCaptions(ground)
    expect(caps).toHaveLength(25)
    expect(caps.every(c => c.label.length > 0)).toBe(true)
  })
})
