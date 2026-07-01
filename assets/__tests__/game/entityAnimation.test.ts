/**
 * #91 Stage 1 — data-driven animation ENGINE. The game is a dumb player of authored data:
 * select the animation whose trigger matches the input, find the frame at `now`, resolve it to a
 * glyph/image (+ mirror). All decisions are DATA; no hardcoded walk/run/flip in the engine.
 */
import {
  selectAnimation, loopFrameIndex, resolveFrame, activeFrame,
  DEFAULT_CHARACTER_ANIMATIONS, type EntityAnimation,
} from '@/game/runtime/entityAnimation'
import { EMOJI_STYLE } from '@/game/artStyle'

const A = DEFAULT_CHARACTER_ANIMATIONS

describe('#89 — every person uses the player-style standing figure (not the 🧑 face)', () => {
  test('npc + player both map to 🧍', () => {
    expect(EMOJI_STYLE.map.npc).toMatchObject({ kind: 'glyph', char: '🧍' })
    expect(EMOJI_STYLE.map.player).toMatchObject({ kind: 'glyph', char: '🧍' })
  })
})

describe('selectAnimation — trigger + direction matching', () => {
  test('moving picks the move animation for the FACING', () => {
    const a = selectAnimation(A, { moving: true, facing: 'left' })
    expect(a?.trigger.on).toBe('move')
    expect(a?.direction).toBe('left')
    expect(a?.trigger.whileRunning).toBeFalsy() // walk, not run
  })
  test('running prefers the run variant of that direction', () => {
    const a = selectAnimation(A, { moving: true, facing: 'right', running: true })
    expect(a?.direction).toBe('right')
    expect(a?.trigger.whileRunning).toBe(true)
    expect(a?.name).toBe('run right')
  })
  test('not moving → idle', () => {
    expect(selectAnimation(A, { moving: false, facing: 'down' })?.trigger.on).toBe('idle')
  })
  test('a transient action beats movement', () => {
    const anims: EntityAnimation[] = [
      ...A,
      { id: 'atk', name: 'attack', trigger: { on: 'attack' }, direction: 'any', frames: [{ char: '⚔️' }], durationMs: 200, loop: false },
    ]
    expect(selectAnimation(anims, { moving: true, facing: 'up', action: 'attack' })?.trigger.on).toBe('attack')
  })
})

describe('loopFrameIndex — stateless cycle + rest during delay', () => {
  const anim: EntityAnimation = { id: 'x', name: 'x', trigger: { on: 'move' }, direction: 'any', frames: [{}, { char: '🚶' }], durationMs: 300, loopDelayMs: 0, loop: true }
  test('two frames alternate on the 150ms beat', () => {
    expect(loopFrameIndex(anim, 0)).toBe(0)
    expect(loopFrameIndex(anim, 150)).toBe(1)
    expect(loopFrameIndex(anim, 300)).toBe(0) // wraps
    expect(loopFrameIndex(anim, 450)).toBe(1)
  })
  test('rests on frame 0 during the loop delay', () => {
    const withDelay: EntityAnimation = { ...anim, durationMs: 200, loopDelayMs: 200 }
    expect(loopFrameIndex(withDelay, 100)).toBe(1) // 200/2=100ms per frame → frame 1 at t=100
    expect(loopFrameIndex(withDelay, 250)).toBe(0) // t=250 in [200,400) delay → rest
  })
  test('a single-frame animation is always frame 0', () => {
    expect(loopFrameIndex({ ...anim, frames: [{ char: '🧍' }] }, 999)).toBe(0)
  })
})

describe('resolveFrame / activeFrame — what to draw (data, incl. flip)', () => {
  test('empty frame falls back to the base tile; char frame wins; flipX carries', () => {
    expect(resolveFrame({}, { char: '🧍' })).toEqual({ char: '🧍', flipX: false })
    expect(resolveFrame({ char: '🚶', flipX: true }, { char: '🧍' })).toEqual({ char: '🚶', flipX: true })
  })
  test('no animations → the base tile, never mirrored', () => {
    expect(activeFrame([], { char: '👾' }, { moving: true, facing: 'right' }, 150)).toEqual({ char: '👾', flipX: false })
  })
  test('the walk cycle is 🚶 then 🚶 MIRRORED — same emoji, NEVER back to the idle 🧍 mid-move', () => {
    // walk durationMs 440, 2 frames → 220ms each. Frame 0 = 🚶, frame 1 = 🚶 mirrored. Both 🚶
    // (one consistent figure/colour); the mirror is the step motion.
    expect(activeFrame(A, { char: '🧍' }, { moving: true, facing: 'left' }, 0)).toEqual({ char: '🚶', flipX: false })
    expect(activeFrame(A, { char: '🧍' }, { moving: true, facing: 'left' }, 250)).toEqual({ char: '🚶', flipX: true })
    // never the idle glyph while moving:
    for (const t of [0, 100, 250, 400, 500]) {
      expect(activeFrame(A, { char: '🧍' }, { moving: true, facing: 'down' }, t).char).toBe('🚶')
    }
  })
  test('running swaps the moving emoji to 🏃 (still same-emoji cycle)', () => {
    expect(activeFrame(A, { char: '🧍' }, { moving: true, running: true, facing: 'right' }, 0).char).toBe('🏃')
    expect(activeFrame(A, { char: '🧍' }, { moving: false, facing: 'down' }, 0).char).toBe('🧍') // stationary → idle
  })
})

describe('the seed is DATA (idle + walk×4 + run×4), right-facing mirrored', () => {
  test('shape', () => {
    expect(A.filter(a => a.trigger.on === 'idle')).toHaveLength(1)
    expect(A.filter(a => a.trigger.on === 'move' && !a.trigger.whileRunning)).toHaveLength(4)
    expect(A.filter(a => a.trigger.on === 'move' && a.trigger.whileRunning)).toHaveLength(4)
    const right = A.find(a => a.name === 'walk right')!
    expect(right.frames[1].flipX).toBe(true)
  })
})
