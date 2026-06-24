import {
  frameAt,
  cycleActive,
  cycleFrames,
  activeFrames,
  type Animation,
  type AnimationCycle,
} from '@/engine/animationCycles'

const A: Animation = { id: 'A', frames: [['a0'], ['a1'], ['a2']], durationMs: 300, loop: true }
const B: Animation = { id: 'B', frames: [['b0'], ['b1']], durationMs: 200, loop: true }
const ONE: Animation = { id: 'ONE', frames: [['x0'], ['x1']], durationMs: 100, loop: false }
const byId = { A, B, ONE }

describe('frameAt — frame selection over an animation timeline', () => {
  it('advances one frame per (duration/frames) and loops', () => {
    expect(frameAt(A, 0)).toEqual(['a0'])
    expect(frameAt(A, 100)).toEqual(['a1']) // 300/3 = 100ms per frame
    expect(frameAt(A, 250)).toEqual(['a2'])
    expect(frameAt(A, 300)).toEqual(['a0']) // wraps
  })
  it('one-shot (loop=false) holds the last frame past the end', () => {
    expect(frameAt(ONE, 0)).toEqual(['x0'])
    expect(frameAt(ONE, 60)).toEqual(['x1'])
    expect(frameAt(ONE, 9999)).toEqual(['x1']) // held, not wrapped
  })
  it('single-frame / zero-duration animations are safe', () => {
    expect(frameAt({ id: 's', frames: [['only']], durationMs: 0, loop: true }, 5)).toEqual(['only'])
  })
})

describe('cycleActive — trigger gating', () => {
  it('always-cycles are always active', () => {
    const c: AnimationCycle = { id: 'c', animations: ['A'], mode: 'sequential', delayMs: 0, trigger: { kind: 'always' } }
    expect(cycleActive(c, new Set())).toBe(true)
  })
  it('state-cycles activate only while their state is active', () => {
    const c: AnimationCycle = { id: 'c', animations: ['A'], mode: 'sequential', delayMs: 0, trigger: { kind: 'state', state: 'combat' } }
    expect(cycleActive(c, new Set(['combat']))).toBe(true)
    expect(cycleActive(c, new Set(['walk']))).toBe(false)
  })
})

describe('cycleFrames — the three modes', () => {
  it('SEQUENTIAL plays A then B in order, looping (no delay = continuous)', () => {
    const c: AnimationCycle = { id: 'c', animations: ['A', 'B'], mode: 'sequential', delayMs: 0, trigger: { kind: 'always' } }
    // period = 300 + 200 = 500. t in [0,300) → A, [300,500) → B.
    expect(cycleFrames(c, byId, 50, 0)).toEqual([['a0']]) // A frame 0
    expect(cycleFrames(c, byId, 150, 0)).toEqual([['a1']]) // A frame 1
    expect(cycleFrames(c, byId, 350, 0)).toEqual([['b0']]) // into B
    expect(cycleFrames(c, byId, 500, 0)).toEqual([['a0']]) // wraps back to A
  })

  it('STACKED plays every animation at once (one frame each — layers to composite)', () => {
    const c: AnimationCycle = { id: 'c', animations: ['A', 'B'], mode: 'stacked', delayMs: 0, trigger: { kind: 'always' } }
    // at t=100: A→frame1 (100/100), B→frame1 (100/100). Both present.
    expect(cycleFrames(c, byId, 100, 0)).toEqual([['a1'], ['b1']])
  })

  it('the delay portion of a sequential slot holds the last frame', () => {
    const c: AnimationCycle = { id: 'c', animations: ['B'], mode: 'sequential', delayMs: 100, trigger: { kind: 'always' } }
    // slot = 200 + 100 = 300. [0,200) plays B, [200,300) is delay → hold last frame.
    expect(cycleFrames(c, byId, 250, 0)).toEqual([['b1']]) // held last frame during delay
  })

  it('RANDOMIZED is DETERMINISTIC (same inputs → same pick)', () => {
    const c: AnimationCycle = { id: 'c', animations: ['A', 'B'], mode: 'randomized', delayMs: 0, trigger: { kind: 'always' } }
    expect(cycleFrames(c, byId, 120, 0)).toEqual(cycleFrames(c, byId, 120, 0))
  })
})

describe('activeFrames — composites ONLY active cycles (independent / stackable)', () => {
  const walk: AnimationCycle = { id: 'walk', animations: ['A'], mode: 'sequential', delayMs: 0, trigger: { kind: 'state', state: 'walk' } }
  const attack: AnimationCycle = { id: 'attack', animations: ['B'], mode: 'stacked', delayMs: 0, trigger: { kind: 'state', state: 'combat' } }
  const cycles = [walk, attack]

  it('walking + attacking at once → BOTH cycles contribute (overlap)', () => {
    const frames = activeFrames(cycles, byId, new Set(['walk', 'combat']), 100, 0)
    expect(frames).toEqual([['a1'], ['b1']]) // walk frame + attack frame, composited
  })
  it('only idle (neither state) → no cycles active → no frames', () => {
    expect(activeFrames(cycles, byId, new Set(['idle']), 100, 0)).toEqual([])
  })
})
