import '@/__tests__/helpers/installTilesetSeed' // the walk/run pose tiles live in the loaded DB tileset
import { seedCharacterAnimations, resolveFrame, needsAnimationReseed, type EntityAnimation } from '@/game/runtime/entityAnimation'

/**
 * The default person animation SEED must reference DB tiles, not hardcoded emoji glyphs (Image #1: the
 * player-animation modal showed raw 🚶/🏃 in the OS font, inconsistent with the baked Noto tiles). Frame 0
 * stays empty (= the entity's own DB tile); the walk/run frames point at the baked `emoji:walk`/`emoji:run`
 * tiles, so they render in the same consistent font as everything else.
 */
describe('default character animation seed uses DB tiles, not hardcoded emoji', () => {
  const anims = seedCharacterAnimations()

  it('walk frames reference the emoji:walk DB tile (no raw char)', () => {
    const walk = anims.find(a => a.name === 'walk down')
    expect(walk).toBeDefined()
    for (const f of walk!.frames) {
      expect(f.char).toBeUndefined()
      expect(f.tileId).toBe('emoji:walk')
    }
  })

  it('run frames reference the emoji:run DB tile (no raw char)', () => {
    const run = anims.find(a => a.name === 'run up')
    expect(run).toBeDefined()
    for (const f of run!.frames) {
      expect(f.char).toBeUndefined()
      expect(f.tileId).toBe('emoji:run')
    }
  })

  it('the walk tile resolves to the baked walk PNG (image, consistent font)', () => {
    const walk = anims.find(a => a.name === 'walk left')!
    const resolved = resolveFrame(walk.frames[0], { char: '🧍' })
    expect(resolved.image?.src).toBe('/tiles/emoji/baked/walk.png')
  })

  it('frame 0 of idle stays the entity’s OWN tile (empty frame → base)', () => {
    const idle = anims.find(a => a.name === 'idle')!
    expect(idle.frames[0]).toEqual({})
    expect(resolveFrame(idle.frames[0], { char: '🧍' })).toMatchObject({ char: '🧍' })
  })

  it('a right-facing walk still mirrors via flipX (the step motion is data, not the tile)', () => {
    const walk = anims.find(a => a.name === 'walk right')!
    expect(walk.frames.some(f => f.flipX)).toBe(true)
  })
})

describe('needsAnimationReseed — reseed the outdated hardcoded-emoji default, keep custom sets', () => {
  const oldSeed: EntityAnimation[] = [
    { id: 'char-walk-down', name: 'walk down', trigger: { on: 'move' }, direction: 'down', frames: [{ char: '🚶' }, { char: '🚶', flipX: true }], durationMs: 440, loop: true },
  ]
  const customSet: EntityAnimation[] = [
    { id: 'x', name: 'walk down', trigger: { on: 'move' }, direction: 'down', frames: [{ tileId: 'emoji:ninja' }], durationMs: 440, loop: true },
  ]

  it('reseeds an empty / never-seeded person', () => {
    expect(needsAnimationReseed(undefined)).toBe(true)
    expect(needsAnimationReseed([])).toBe(true)
  })
  it('reseeds the OUTDATED default (raw 🚶/🏃 frames)', () => {
    expect(needsAnimationReseed(oldSeed)).toBe(true)
  })
  it('does NOT reseed the current DB-tile default or a custom set (preserves user authoring)', () => {
    expect(needsAnimationReseed(seedCharacterAnimations())).toBe(false)
    expect(needsAnimationReseed(customSet)).toBe(false)
  })
})
