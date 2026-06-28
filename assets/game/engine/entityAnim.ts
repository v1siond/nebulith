export type EntityAnimState = 'idle' | 'walk' | 'combat'

export function entityAnimState(opts: { moving: boolean; inRange: boolean; kind: string }): EntityAnimState {
  if (opts.inRange && opts.kind === 'enemy') return 'combat'
  if (opts.moving) return 'walk'
  return 'idle'
}

// idle = static (constant index, no time advance). walk/combat = time-based swap.
// Periods are the per-frame hold time; smaller = faster leg/arm swap.
const STATE_MS: Record<EntityAnimState, number> = { idle: 0, walk: 300, combat: 280 }

export function entityFrameIndex(state: EntityAnimState, now: number, frameCount: number): number {
  if (frameCount <= 1) return 0
  const ms = STATE_MS[state]
  if (ms <= 0) return 0 // idle holds frame 0 — no leg/arm swap
  return Math.floor(now / ms) % frameCount
}
