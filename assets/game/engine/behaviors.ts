/**
 * Structure / asset behaviors — pure timing helpers for animated props.
 *
 * A "cannon" fires on a fixed interval; a "lamp" pulses its light. Kept pure (time
 * passed in) so cadence + animation phase are deterministic and unit-testable; the
 * play loop owns the clock, the per-asset last-fired timestamps, and the effects
 * (spawning a shot, brightening a tile).
 */

/** True when `intervalMs` has elapsed since the last shot — the cannon may fire. */
export function shouldFire(intervalMs: number, lastFiredAt: number, now: number): boolean {
  return now - lastFiredAt >= intervalMs
}

/** A lamp's brightness phase in [0,1] for a looping glow animation. */
export function lampPulse(now: number, periodMs = 1200): number {
  return (Math.sin((now / periodMs) * Math.PI * 2) + 1) / 2
}
