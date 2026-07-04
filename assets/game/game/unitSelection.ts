/**
 * Pure helpers for the click + Tab UNIT-SELECTION ("target") system. Click-on-figure kept failing
 * because units are billboarded above their grid cell across 3 camera modes; instead we pick the unit
 * whose DRAWN figure is nearest the click in SCREEN space, and Tab cycles the selection through the unit
 * list. No DOM, deterministic, unit-tested. The caller computes each unit's screen point via the view
 * projection. (Distinct from combat `game/runtime/targeting` — which enemy a melee swing hits.)
 */

export interface ScreenPoint {
  id: string
  x: number
  y: number
}

/** The id of the candidate whose screen point is NEAREST to (px,py), within `maxDist` px — else null.
 *  Robust selection: pick the closest drawn figure to the click instead of an exact grid-cell hit. */
export function nearestUnit(candidates: readonly ScreenPoint[], px: number, py: number, maxDist: number): string | null {
  let best: string | null = null
  let bestD = Infinity
  for (const c of candidates) {
    const dx = c.x - px
    const dy = c.y - py
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = c.id
    }
  }
  return best !== null && bestD <= maxDist * maxDist ? best : null
}

export interface UnitCell {
  id: string
  col: number
  row: number
}

/** Ids of units within `range` cells of the player (pCol,pRow), NEAREST first — the Tab-target
 *  candidates. The caller passes only eligible units (living ENEMIES); this applies the distance cutoff
 *  (≤ range, so Tab only targets enemies close to the player) and nearest-first ordering so cycling is
 *  predictable. */
export function unitsInRange(units: readonly UnitCell[], pCol: number, pRow: number, range: number): string[] {
  return units
    .map(u => ({ id: u.id, d: Math.hypot(u.col - pCol, u.row - pRow) }))
    .filter(u => u.d <= range)
    .sort((a, b) => a.d - b.d)
    .map(u => u.id)
}

/** The next selection id cycling through `ids` from `current` (dir +1 forward / -1 back), wrapping. When
 *  `current` isn't in the list (or is null), returns the first (dir +1) or last (dir -1). null if empty. */
export function cycleSelection(ids: readonly string[], current: string | null, dir: 1 | -1 = 1): string | null {
  if (ids.length === 0) return null
  const i = current === null ? -1 : ids.indexOf(current)
  if (i === -1) return dir === 1 ? ids[0] : ids[ids.length - 1]
  return ids[(i + dir + ids.length) % ids.length]
}
