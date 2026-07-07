/**
 * A building as ground-plan TILES — the data half of "buildings are just tiles" (replacing the facade
 * composer). Given a W×D footprint and a floor count, produce a flat grid of cells: the PERIMETER is
 * `wall` (iso height = floors), the INTERIOR is `floor` (walkable, flat), and one front-centre perimeter
 * cell is a `door` (flat; the caller wires its connector to a house template). Windows/roof are variants
 * layered by the generator later. Pure + unit-tested; the generator stamps these as normal tile assets.
 */

export interface FootprintCell {
  /** offset from the footprint's top-left (dx along width, dy along depth). */
  dx: number
  dy: number
  kind: 'wall' | 'floor' | 'door'
  /** iso block height: walls rise `floors` blocks; floor/door are flat (0). */
  height: number
}

/** Generate the footprint tile grid. `floors` clamps to ≥1; a door is placed only when the front edge is
 *  wide enough (w ≥ 3), at the front (max-dy) row's centre column. */
export function buildingFootprint(w: number, d: number, floors: number): FootprintCell[] {
  const height = Math.max(1, Math.floor(floors))
  const doorX = Math.floor((w - 1) / 2)
  const hasDoor = w >= 3 && d >= 1
  const cells: FootprintCell[] = []
  for (let dy = 0; dy < d; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const perimeter = dx === 0 || dx === w - 1 || dy === 0 || dy === d - 1
      const isDoor = hasDoor && dy === d - 1 && dx === doorX
      const kind: FootprintCell['kind'] = isDoor ? 'door' : perimeter ? 'wall' : 'floor'
      cells.push({ dx, dy, kind, height: kind === 'wall' ? height : 0 })
    }
  }
  return cells
}
