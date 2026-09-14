/**
 * SPRITE PLAYBACK, the thing that was stubbed.
 *
 * `spriteFrameIndex` has been real, clock-derived and tested all along, and nothing consumed it:
 * `resolveAssetAnimation` said so in its own comment, returning null for a sprite because it writes no render
 * settings ("playback stubbed in Phase 1"). So a tile carrying a frame-swap animation animated nothing, in any
 * view. `spriteFrame` is the consumer.
 *
 * WHY THIS MATTERS FOR WATER SPECIFICALLY: water is a FLOOR, and a floor is an ordinary level-0 asset whose
 * identity rides on `tileKey`, never a label (`makeFloorAsset`). So the label seam that animates a composition
 * cell could never animate a floor. This resolves per ASSET, which is why it reaches the ground.
 *
 * The frame is returned resolved but NOT turned into a picture: `frameImage` lives in `render/shared`, and
 * `shared` already imports the animation bridge, so resolving it there would close a circular import.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { spriteFrame } from '@/engine/render/assetAnimation'
import { type GridAsset } from '@/engine/IsometricGrid'
import { ASCII_STYLE, EMOJI_STYLE } from '@/game/artStyle'
import { type Animation } from '@/engine/animation/tileAnimation'

/** A two-frame ambient loop: 1000ms, so frame 0 owns [0,500) and frame 1 owns [500,1000). */
const ripple = (over: Partial<Animation> = {}): Animation =>
  ({
    id: 'water_ripple',
    name: 'ripple',
    kind: 'sprite',
    durationMs: 1000,
    loop: true,
    frames: [{ tileId: 'ascii:water' }, { tileId: 'ascii:water_shallow' }],
    trigger: { on: 'load' },
    ...over,
  }) as Animation

const floorAsset = (animations?: Animation[]): GridAsset =>
  ({ art: [''], col: 2, row: 3, type: 'floor', tileKey: 'water', heightLevel: 0, blocking: false, placedAt: 0, animations }) as unknown as GridAsset

describe('a placed asset shows its live sprite frame', () => {
  it('returns NOTHING for an asset with no animations, so an un-animated tile is untouched', () => {
    // `water_still`, not `water`. This used the river label, which carries four frames on its own row, so with
    // no per-instance animations it falls through to the TILE's and is correctly NOT null. The fixture used to
    // hide that by carrying a frameless `water`. A puddle is the honest example of a tile that never animates.
    const still = (animations?: Animation[]): GridAsset =>
      ({ art: [''], col: 2, row: 3, type: 'floor', tileKey: 'water_still', heightLevel: 0, blocking: false, placedAt: 0, animations }) as unknown as GridAsset
    expect(spriteFrame(still(), 0, ASCII_STYLE, 'iso', 'day')).toBeNull()
    expect(spriteFrame(still([]), 500, ASCII_STYLE, 'iso', 'day')).toBeNull()
  })

  it('advances with the CLOCK, on the contract spriteFrameIndex already pins', () => {
    const a = floorAsset([ripple()])
    // frame 0 owns the first half of the loop, frame 1 the second
    expect(spriteFrame(a, 0, ASCII_STYLE, 'iso', 'day')).toMatchObject({ image: { src: expect.stringContaining('water') } })
    const early = spriteFrame(a, 100, ASCII_STYLE, 'iso', 'day')
    const late = spriteFrame(a, 700, ASCII_STYLE, 'iso', 'day')
    expect(early).not.toBeNull()
    expect(late).not.toBeNull()
    // the two halves of the loop are DIFFERENT pictures, which is what "animated" means
    expect(late!.image?.src).not.toBe(early!.image?.src)
  })

  it('comes back to frame 0 on the next loop, so it cycles rather than running off the end', () => {
    const a = floorAsset([ripple()])
    const first = spriteFrame(a, 100, ASCII_STYLE, 'iso', 'day')
    const nextLoop = spriteFrame(a, 1100, ASCII_STYLE, 'iso', 'day')
    expect(nextLoop!.image?.src).toBe(first!.image?.src)
  })

  it('obeys SCOPE: a sprite scoped to one view or style does not play in another', () => {
    const isoOnly = floorAsset([ripple({ scope: { views: ['iso'] } } as Partial<Animation>)])
    expect(spriteFrame(isoOnly, 100, ASCII_STYLE, 'iso', 'day')).not.toBeNull()
    expect(spriteFrame(isoOnly, 100, ASCII_STYLE, '2d', 'day')).toBeNull()

    const emojiOnly = floorAsset([ripple({ scope: { styles: ['emoji'] } } as Partial<Animation>)])
    expect(spriteFrame(emojiOnly, 100, EMOJI_STYLE, 'iso', 'day')).not.toBeNull()
    expect(spriteFrame(emojiOnly, 100, ASCII_STYLE, 'iso', 'day')).toBeNull()
  })

  it('obeys the NIGHT gate, the same one the settings path uses', () => {
    const nightOnly = floorAsset([ripple({ trigger: { on: 'night' } } as Partial<Animation>)])
    expect(spriteFrame(nightOnly, 100, ASCII_STYLE, 'iso', 'night')).not.toBeNull()
    expect(spriteFrame(nightOnly, 100, ASCII_STYLE, 'iso', 'day')).toBeNull()
  })

  it('lets the higher PRIORITY sprite win when a tile carries two', () => {
    const quiet = ripple({ id: 'quiet', priority: 0, frames: [{ tileId: 'ascii:water' }, { tileId: 'ascii:water' }] })
    const loud = ripple({ id: 'loud', priority: 5, frames: [{ tileId: 'ascii:water_deep' }, { tileId: 'ascii:water_deep' }] })
    const a = floorAsset([quiet, loud])
    expect(spriteFrame(a, 100, ASCII_STYLE, 'iso', 'day')!.image?.src).toContain('water_deep')
  })

  it('returns NOTHING for a sprite with no frames, rather than an empty picture', () => {
    const empty = floorAsset([ripple({ frames: [] } as Partial<Animation>)])
    expect(spriteFrame(empty, 100, ASCII_STYLE, 'iso', 'day')).toBeNull()
  })
})
