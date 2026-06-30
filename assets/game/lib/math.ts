/**
 * Shared numeric + RNG micro-helpers, consolidated from per-file copies that had
 * drifted across `src/engine/*` and `src/game/*`. Pure except for `randInt`, which
 * reads the global `Math.random`; `randIntWith` stays pure given a seeded `rng`.
 */

/** Linear interpolation between `a` and `b`: t=0 → a, t=1 → b. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Clamp `v` into the inclusive `[lo, hi]` range. */
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Random integer in the inclusive `[lo, hi]` range, drawn from a supplied (e.g. seeded) `rng`. */
export const randIntWith = (rng: () => number, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1))

/** Random integer in the inclusive `[lo, hi]` range, using the global `Math.random`. */
export const randInt = (lo: number, hi: number): number => randIntWith(Math.random, lo, hi)

/** Chebyshev (8-neighbour / chessboard) cell distance. */
export const chebyshev = (
  a: { col: number; row: number },
  b: { col: number; row: number },
): number => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row))

/** Manhattan (4-neighbour / taxicab) cell distance. */
export const manhattan = (
  a: { col: number; row: number },
  b: { col: number; row: number },
): number => Math.abs(a.col - b.col) + Math.abs(a.row - b.row)
