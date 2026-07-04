import { aimDelta, type PlayerState } from '@/game/runtime/player'

// Minimal player — aimDelta only reads `aim` + `facing`.
const player = (aim: { col: number; row: number } | undefined, facing: PlayerState['facing'] = 'up'): PlayerState =>
  ({ x: 0, z: 0, facing, aim } as unknown as PlayerState)

describe('aimDelta — the 8-way direction the player aims / shoots', () => {
  it('returns the diagonal aim verbatim (both axes non-zero) in 2D and iso', () => {
    expect(aimDelta(player({ col: 1, row: 1 }), true)).toEqual([1, 1])
    expect(aimDelta(player({ col: -1, row: 1 }), false)).toEqual([-1, 1])
  })
  it('falls back to the 4-way facing only when no aim is held', () => {
    expect(aimDelta(player(undefined, 'up'), true)).toEqual([0, -1]) // 2D up
    expect(aimDelta(player(undefined, 'up'), false)).toEqual([-1, -1]) // iso up
  })
})
