/**
 * THE PLAYER ALWAYS LANDS WHERE THEY CAN WALK.
 *
 * The old rule checked ONE cell — not water, not blocked — and a one-cell pocket between trees passes that
 * test while leading nowhere. It only held because every generator happens to repair its own floor into one
 * piece; a hand-edited map, or any future generator, owed nothing. This picks a cell in the LARGEST connected
 * walkable area of the live grid, as close as it can to where the generator wanted the player.
 *
 * Connected ORTHOGONALLY on purpose. The player is a body almost a cell wide (a 0.42-cell half-extent), and
 * every corner of it must stay clear, so it cannot squeeze through a diagonal gap between two blockers. Two
 * cells that only touch at a corner are, for this player, two different places.
 *
 * Pure: a walkability predicate and a size in, a cell out. The editor supplies the predicate.
 */
export interface SpawnTarget { col: number; row: number }

export function spawnInMainArea(
  isOpen: (col: number, row: number) => boolean,
  cols: number,
  rows: number,
  target: SpawnTarget,
): SpawnTarget | null {
  const region = new Int32Array(cols * rows).fill(-1)
  const sizes: number[] = []
  const at = (c: number, r: number) => r * cols + c
  const open = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && isOpen(c, r)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!open(c, r) || region[at(c, r)] !== -1) continue
      const id = sizes.length
      let size = 0
      const stack: number[] = [at(c, r)]
      region[at(c, r)] = id
      while (stack.length) {
        const i = stack.pop()!
        size++
        const cc = i % cols
        const rr = (i - cc) / cols
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = cc + dc
          const nr = rr + dr
          if (!open(nc, nr) || region[at(nc, nr)] !== -1) continue
          region[at(nc, nr)] = id
          stack.push(at(nc, nr))
        }
      }
      sizes.push(size)
    }
  }
  if (sizes.length === 0) return null

  const main = sizes.indexOf(Math.max(...sizes))
  const inside = target.col >= 0 && target.row >= 0 && target.col < cols && target.row < rows
  if (inside && region[at(target.col, target.row)] === main) return { col: target.col, row: target.row }

  // The nearest cell of the main area — as close to the intended spawn as the map allows.
  let best: SpawnTarget | null = null
  let bestD = Infinity
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (region[at(c, r)] !== main) continue
      const d = (c - target.col) ** 2 + (r - target.row) ** 2
      if (d >= bestD) continue
      bestD = d
      best = { col: c, row: r }
    }
  }
  return best
}
