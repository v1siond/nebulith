import { aimDelta, jumpLandingCell, type PlayerState } from '@/game/runtime/player'

// Minimal player — aimDelta only reads `aim` + `facing`.
const player = (aim: { col: number; row: number } | undefined, facing: PlayerState['facing'] = 'up'): PlayerState =>
  ({ x: 0, z: 0, facing, aim } as unknown as PlayerState)

const open = () => false // nothing blocked

describe('aimDelta — the 8-way direction the jump now follows (#66)', () => {
  it('returns the diagonal aim verbatim (both axes non-zero) in 2D and iso', () => {
    expect(aimDelta(player({ col: 1, row: 1 }), true)).toEqual([1, 1])
    expect(aimDelta(player({ col: -1, row: 1 }), false)).toEqual([-1, 1])
  })
  it('falls back to the 4-way facing only when no aim is held', () => {
    expect(aimDelta(player(undefined, 'up'), true)).toEqual([0, -1]) // 2D up
    expect(aimDelta(player(undefined, 'up'), false)).toEqual([-1, -1]) // iso up
  })
})

describe('jumpLandingCell — diagonal jumps move BOTH axes (#66 regression)', () => {
  it('a diagonal delta lands diagonally — JUMP_CLEAR+1 cells on BOTH col and row', () => {
    expect(jumpLandingCell(5, 5, 1, 1, true, open, 50, 50)).toEqual({ col: 7, row: 7 })
    expect(jumpLandingCell(5, 5, -1, 1, true, open, 50, 50)).toEqual({ col: 3, row: 7 })
  })
  it('a cardinal delta still moves only one axis', () => {
    expect(jumpLandingCell(5, 5, 1, 0, true, open, 50, 50)).toEqual({ col: 7, row: 5 })
    expect(jumpLandingCell(5, 5, 0, -1, true, open, 50, 50)).toEqual({ col: 5, row: 3 })
  })
  it('a standing jump (forward=false) stays on the same cell', () => {
    expect(jumpLandingCell(5, 5, 1, 1, false, open, 50, 50)).toEqual({ col: 5, row: 5 })
  })
  it('a blocked far cell shortens the leap to the nearest open cell', () => {
    const blockFar = (c: number, r: number) => c === 7 && r === 7 // d=2 blocked, d=1 open
    expect(jumpLandingCell(5, 5, 1, 1, true, blockFar, 50, 50)).toEqual({ col: 6, row: 6 })
  })
  it('returns null when nothing ahead is reachable (off the grid edge)', () => {
    expect(jumpLandingCell(49, 49, 1, 1, true, open, 50, 50)).toBeNull()
  })
})

// A running jump carries MOMENTUM: it leaps farther than a walking hop (#34). The arc duration is
// fixed, so a longer leap = a faster arc = it reads as a run; a short hop reads as a walk. Passing the
// per-gait `reach` is what makes the jump match how you were moving instead of a constant-speed hop.
describe('jumpLandingCell — running jump reaches farther than a walking hop (#34)', () => {
  it('a walking hop (reach 1) lands ONE cell ahead', () => {
    expect(jumpLandingCell(5, 5, 1, 1, true, open, 50, 50, 1)).toEqual({ col: 6, row: 6 })
    expect(jumpLandingCell(5, 5, 1, 0, true, open, 50, 50, 1)).toEqual({ col: 6, row: 5 })
  })
  it('a running leap (reach 2) lands TWO cells ahead', () => {
    expect(jumpLandingCell(5, 5, 1, 1, true, open, 50, 50, 2)).toEqual({ col: 7, row: 7 })
  })
  it('the running leap clears a 1-cell gap (blocked d=1, open d=2)', () => {
    const blockNear = (c: number, r: number) => c === 6 && r === 6 // d=1 blocked
    expect(jumpLandingCell(5, 5, 1, 1, true, blockNear, 50, 50, 2)).toEqual({ col: 7, row: 7 })
  })
  it('a walking hop canNOT clear a gap — blocked d=1 with reach 1 yields null (keep walking)', () => {
    const blockNear = (c: number, r: number) => c === 6 && r === 6
    expect(jumpLandingCell(5, 5, 1, 1, true, blockNear, 50, 50, 1)).toBeNull()
  })
  it('defaults to the running reach (2) when no reach is passed (back-compat)', () => {
    expect(jumpLandingCell(5, 5, 1, 1, true, open, 50, 50)).toEqual({ col: 7, row: 7 })
  })
})
