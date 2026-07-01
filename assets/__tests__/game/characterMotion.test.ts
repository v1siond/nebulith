/**
 * #89/#90 — every PERSON uses the player-style standing figure, and moving cycles the 3-frame
 * [idle, motion, idle] walk/run animation (Shift → run). Emoji is the v1 test for real sprite frames.
 */
import { characterMotionChar, MOTION_EMOJI, EMOJI_STYLE } from '@/game/artStyle'

const IDLE = '🧍'

describe('characterMotionChar — walk/run frame cycle', () => {
  test('still → the idle glyph, regardless of time or run flag', () => {
    expect(characterMotionChar(IDLE, false, false, 0)).toBe(IDLE)
    expect(characterMotionChar(IDLE, false, true, 150)).toBe(IDLE)
  })

  test('walking alternates idle ↔ 🚶 on the beat (current, then walk, then current)', () => {
    expect(characterMotionChar(IDLE, true, false, 0)).toBe(IDLE) // floor(0/150)%2==0 → idle
    expect(characterMotionChar(IDLE, true, false, 150)).toBe(MOTION_EMOJI.walk) // %2==1 → walk
    expect(characterMotionChar(IDLE, true, false, 300)).toBe(IDLE)
    expect(characterMotionChar(IDLE, true, false, 450)).toBe(MOTION_EMOJI.walk)
  })

  test('running swaps the motion frame to 🏃 (idle frame unchanged)', () => {
    expect(characterMotionChar(IDLE, true, true, 150)).toBe(MOTION_EMOJI.run)
    expect(characterMotionChar(IDLE, true, true, 0)).toBe(IDLE)
    expect(MOTION_EMOJI.walk).not.toBe(MOTION_EMOJI.run)
  })
})

describe('#89 — every person uses the player-style figure', () => {
  test('npc + player both map to the same standing-figure glyph (not the 🧑 face)', () => {
    const npc = EMOJI_STYLE.map.npc
    const player = EMOJI_STYLE.map.player
    expect(npc).toMatchObject({ kind: 'glyph', char: IDLE })
    expect(player).toMatchObject({ kind: 'glyph', char: IDLE })
  })
})
