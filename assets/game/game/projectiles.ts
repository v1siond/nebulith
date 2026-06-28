/**
 * PROJECTILES — pure, time-driven model for a ranged shot that TRAVELS over time and
 * resolves damage ON IMPACT (not at fire). A projectile lerps from its origin cell to
 * the cell the target occupied when it was fired; on arrival we check the target's
 * CURRENT cell: it MISSES if the target stepped off the impact cell, and can still be
 * dodged or blocked by chance. No I/O, no globals — the caller injects the RNG.
 */

export interface Projectile {
  id: string
  fromCol: number
  fromRow: number
  toCol: number
  toRow: number
  targetId: string
  startMs: number
  durationMs: number
  glyph: string
  power: number
}

/** Where the projectile sits (fractional cell) at `now`, lerped along its path. */
export function projectileCellAt(p: Projectile, now: number): { col: number; row: number } {
  const t = p.durationMs <= 0 ? 1 : Math.min(1, Math.max(0, (now - p.startMs) / p.durationMs))
  return { col: p.fromCol + (p.toCol - p.fromCol) * t, row: p.fromRow + (p.toRow - p.fromRow) * t }
}

/** Has the projectile reached its impact cell (travel time elapsed)? */
export function projectileArrived(p: Projectile, now: number): boolean {
  return now >= p.startMs + p.durationMs
}

export type ImpactResult = 'hit' | 'missed_moved' | 'blocked' | 'dodged'

/**
 * Resolve a projectile on arrival against the target's CURRENT cell.
 * - target no longer on the impact cell → 'missed_moved' (they dodged by moving)
 * - else roll dodge, then block (chances are 0–1 fractions; rng() in [0,1))
 * - otherwise it lands → 'hit'
 */
export function resolveImpact(
  p: Projectile,
  targetCell: { col: number; row: number },
  blockChance: number,
  dodgeChance: number,
  rng: () => number,
): ImpactResult {
  if (targetCell.col !== p.toCol || targetCell.row !== p.toRow) return 'missed_moved'
  if (rng() < dodgeChance) return 'dodged'
  if (rng() < blockChance) return 'blocked'
  return 'hit'
}
