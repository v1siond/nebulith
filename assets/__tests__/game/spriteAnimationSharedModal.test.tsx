import '@/__tests__/helpers/installTilesetSeed' // install the DB-equivalent tileset the runtime loads
/**
 * The character/unit frame-swap animation is now the `sprite` KIND inside the ONE shared tile-animation modal
 * (`TileAnimationEditor`) — the user: "merge the character animation as the sprite animation on tile settings
 * modal". Plus the #55 fix: a frame that references a baked tile must render that tile's IMAGE, never a raw
 * glyph. These tests lock both:
 *
 *   1. AVAILABLE FOR TILES AND UNITS — the same modal authors sprite animations for a Tile (both kinds) and a
 *      Unit (sprite only). Adding one produces a real `kind:'sprite'` envelope with the entity frame model
 *      (a frame LIST + an idle/move/attack trigger + a direction) that plays via the engine.
 *   2. BAKED-IMAGE FRAMES (#55) — a frame slot for a tile whose visual is a baked image renders an <img> with
 *      that tile's src, and the tile's SOURCE glyph never leaks out as a text glyph.
 *   3. THE BRIDGE — a unit stores EntityAnimation[]; the modal edits the sprite VIEW and writes the entity
 *      shape back. spriteFromEntity ⇄ entityFromSprite round-trips losslessly.
 */
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { TileAnimationEditor } from '@/components/game/editorChrome'
import { tilesForStyle } from '@/game/artStyle'
import { spriteFromEntity, entityFromSprite, type EntityAnimation } from '@/game/runtime/entityAnimation'
import type { Animation, SpriteAnimation } from '@/engine/animation/tileAnimation'

/** The first emoji tile whose visual is a baked IMAGE — the case #55 is about (a frame that must draw art). */
function anImageUnitTile() {
  const tile = tilesForStyle('emoji').units.find(t => t.visual.kind === 'image')
  if (!tile || tile.visual.kind !== 'image') throw new Error('seed has no baked image unit tile')
  return { id: tile.id, src: tile.visual.src, sourceChar: tile.visual.char }
}

/** A controlled consumer that mirrors the written animation list as JSON so a test can read the shape back. */
function Harness({
  initial = [],
  elementType = 'Character' as const,
  kinds = ['sprite'] as readonly ('settings' | 'sprite')[],
}: {
  initial?: Animation[]
  elementType?: 'Tile' | 'Character'
  kinds?: readonly ('settings' | 'sprite')[]
}) {
  const [anims, setAnims] = useState<Animation[]>(initial)
  const img = anImageUnitTile()
  return (
    <>
      <TileAnimationEditor
        animations={anims}
        elementType={elementType}
        elementLabel="hero"
        spriteContext={{ category: 'units', styleId: 'emoji', baseVisual: { kind: 'image', src: img.src, char: img.sourceChar } }}
        kinds={kinds}
        onChange={setAnims}
      />
      <pre data-testid="state">{JSON.stringify(anims)}</pre>
    </>
  )
}

const readState = (): Animation[] => JSON.parse(screen.getByTestId('state').textContent || '[]')

describe('the character animation merged into the shared modal as the sprite kind', () => {
  it('is available for a UNIT — adding one writes a kind:sprite envelope with the entity frame model', () => {
    render(<Harness elementType="Character" kinds={['sprite']} />)
    fireEvent.click(screen.getByRole('button', { name: /Add sprite animation/i }))
    const s = readState()[0] as SpriteAnimation
    expect(s.kind).toBe('sprite')
    expect(Array.isArray(s.frames)).toBe(true)        // a frame LIST (the entity model), not string[]
    expect(s.frames.length).toBeGreaterThanOrEqual(2)
    expect(s.spriteTrigger?.on).toBe('move')          // an entity-style trigger (idle/move/attack…)
    expect(s.direction).toBeDefined()
  })

  it('is available for a TILE too — the SAME modal offers BOTH settings and sprite adds', () => {
    render(<Harness elementType="Tile" kinds={['settings', 'sprite']} />)
    expect(screen.getByRole('button', { name: /Add settings animation/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Add sprite animation/i }))
    expect((readState()[0] as SpriteAnimation).kind).toBe('sprite')
  })

  it('an added sprite row renders the reused frame editor (a frame strip you can grow)', () => {
    render(<Harness elementType="Character" kinds={['sprite']} />)
    fireEvent.click(screen.getByRole('button', { name: /Add sprite animation/i }))
    // the reused AnimationRow frame strip exposes the Add/Remove-frame controls + a direction select.
    expect(screen.getByLabelText('Add frame')).toBeInTheDocument()
    expect(screen.getByLabelText('Animation direction')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Add frame'))
    expect((readState()[0] as SpriteAnimation).frames.length).toBe(3) // 2 default + 1 added
  })
})

describe('#55 — a sprite frame renders the BAKED tile IMAGE, not a raw glyph', () => {
  it('a frame referencing an image tile draws an <img> with that tile src (and no source-glyph text)', () => {
    const img = anImageUnitTile()
    const anim: SpriteAnimation = {
      id: 's0', name: 'walk', kind: 'sprite',
      frames: [{ tileId: img.id }],
      spriteTrigger: { on: 'move' }, direction: 'down', durationMs: 300, loop: true,
    }
    const { container } = render(<Harness initial={[anim]} elementType="Character" kinds={['sprite']} />)
    // The frame slot draws the baked art via <img src=...> — the SAME image the canvas resolves label→src.
    const imgs = Array.from(container.querySelectorAll('img')) as HTMLImageElement[]
    expect(imgs.some(el => el.getAttribute('src') === img.src)).toBe(true)
    // and the tile's SOURCE glyph (e.g. 🧍) is NOT rendered as a text glyph anywhere (the #55 regression).
    expect(screen.queryByText(img.sourceChar)).toBeNull()
  })
})

describe('the bridge — a unit stores EntityAnimation[] but edits as the sprite kind', () => {
  const walk: EntityAnimation = {
    id: 'walk-left', name: 'walk left',
    trigger: { on: 'move', whileRunning: false },
    direction: 'left',
    frames: [{}, { tileId: 'emoji:walk', flipX: true }],
    durationMs: 440, loopDelayMs: 0, loop: true,
  }

  it('spriteFromEntity → entityFromSprite round-trips a unit animation losslessly', () => {
    expect(entityFromSprite(spriteFromEntity(walk))).toEqual(walk)
  })

  it('spriteFromEntity carries the entity model onto the sprite envelope (frames/trigger/direction)', () => {
    const s = spriteFromEntity(walk)
    expect(s.kind).toBe('sprite')
    expect(s.frames).toEqual(walk.frames)
    expect(s.spriteTrigger).toEqual(walk.trigger)
    expect(s.direction).toBe('left')
    expect(s.durationMs).toBe(440)
  })

  it('editing through the sprite view and mapping back preserves the entity shape', () => {
    const s = spriteFromEntity(walk)
    const edited: SpriteAnimation = { ...s, direction: 'right', durationMs: 300 }
    const back = entityFromSprite(edited)
    expect(back.direction).toBe('right')
    expect(back.durationMs).toBe(300)
    expect(back.trigger.on).toBe('move') // untouched fields survive
    expect(back.frames).toEqual(walk.frames)
  })
})
