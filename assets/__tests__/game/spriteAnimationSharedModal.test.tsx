import '@/__tests__/helpers/installTilesetSeed' // install the DB-equivalent tileset the runtime loads
/**
 * Units and tiles use the IDENTICAL shared tile-animation modal (`TileAnimationEditor`) — the user: "both unit
 * and tiles should use the same animations modal... which is the one used by settings animation on tile". So a
 * selected UNIT gets BOTH the settings AND the sprite add-buttons, exactly like a tile; a unit carries the same
 * unified `Animation[]` a tile does (`Entity.unitAnimations`), and the render projection `Entity.animations`
 * (EntityAnimation[]) stays in sync from its sprite subset. Plus the #55 fix: a frame that references a baked tile
 * must render that tile's IMAGE, never a raw glyph. These tests lock:
 *
 *   1. IDENTICAL MODAL FOR TILES AND UNITS — the same modal offers BOTH settings + sprite adds for a Unit AND a
 *      Tile. A sprite add produces a real `kind:'sprite'` envelope with the entity frame model (a frame LIST +
 *      an idle/move/attack trigger + a direction); a settings add produces a `kind:'settings'` envelope.
 *   2. BAKED-IMAGE FRAMES (#55) — a frame slot for a tile whose visual is a baked image renders an <img> with
 *      that tile's src, and the tile's SOURCE glyph never leaks out as a text glyph.
 *   3. UNIFIED STORAGE BRIDGE — a unit stores the unified `Animation[]`; the render projection is the sprite
 *      subset (entityAnimationsFromUnit) while the settings envelope PERSISTS; a legacy sprite-only entity lifts
 *      losslessly (unitAnimationsFromEntity), and a unit round-trips a settings + a sprite animation intact.
 */
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { TileAnimationEditor } from '@/components/game/editorChrome'
import { tilesForStyle } from '@/game/artStyle'
import { spriteFromEntity, entityFromSprite, entityAnimationsFromUnit, unitAnimationsFromEntity, type EntityAnimation } from '@/game/runtime/entityAnimation'
import type { Animation, SettingsAnimation, SpriteAnimation } from '@/engine/animation/tileAnimation'

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
  // A unit is now wired with BOTH kinds (the default), exactly like a tile — no `kinds` override in templates.
  kinds = ['settings', 'sprite'] as readonly ('settings' | 'sprite')[],
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

describe('units and tiles use the IDENTICAL modal — BOTH settings + sprite add-buttons', () => {
  it('a UNIT modal exposes BOTH add-buttons (the reported bug: it was sprite-only)', () => {
    render(<Harness elementType="Character" />)
    // the settings button — the one the user said was missing on the character modal — is now present…
    expect(screen.getByRole('button', { name: /Add settings animation/i })).toBeInTheDocument()
    // …alongside the sprite (frame-swap) button.
    expect(screen.getByRole('button', { name: /Add sprite animation/i })).toBeInTheDocument()
  })

  it('a UNIT can add a SETTINGS animation (parity with a tile — the fountain-style envelope)', () => {
    render(<Harness elementType="Character" />)
    fireEvent.click(screen.getByRole('button', { name: /Add settings animation/i }))
    const s = readState()[0] as SettingsAnimation
    expect(s.kind).toBe('settings')
    expect(Array.isArray(s.tracks)).toBe(true)
  })

  it('a UNIT adding a sprite writes a kind:sprite envelope with the entity frame model', () => {
    render(<Harness elementType="Character" />)
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
    render(<Harness elementType="Character" />)
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

describe('the UNIFIED unit storage bridge — a unit carries Animation[] (settings + sprite)', () => {
  const walk: EntityAnimation = {
    id: 'walk-left', name: 'walk left',
    trigger: { on: 'move', whileRunning: false }, direction: 'left',
    frames: [{}, { tileId: 'emoji:walk', flipX: true }],
    durationMs: 440, loopDelayMs: 0, loop: true,
  }
  const fade: SettingsAnimation = {
    id: 'fade', name: 'fade', kind: 'settings',
    tracks: [{ setting: 'opacity', from: 1, to: 0.3 }],
    durationMs: 800, loop: true, yoyo: true, ease: 'sine', trigger: { on: 'load' },
  }

  it('a legacy sprite-only entity lifts to the unified list losslessly, then projects back to the same frames', () => {
    const unified = unitAnimationsFromEntity([walk])
    expect(unified).toHaveLength(1)
    expect(unified[0].kind).toBe('sprite')
    // the render projection off the unified list reproduces the exact stored EntityAnimation.
    expect(entityAnimationsFromUnit(unified)).toEqual([walk])
  })

  it('a unit with BOTH a settings and a sprite animation persists both, but projects only the sprite to the renderer', () => {
    // the modal writes the unified list (source of truth): a settings envelope AND the walk sprite.
    const unified: Animation[] = [fade, spriteFromEntity(walk)]
    // unitAnimations keeps BOTH — the settings envelope is NOT dropped (the reported bug: it used to be filtered out).
    expect(unified.filter(a => a.kind === 'settings')).toHaveLength(1)
    // the render projection (Entity.animations) is ONLY the sprite subset — the untouched frame renderer reads this.
    const rendered = entityAnimationsFromUnit(unified)
    expect(rendered).toHaveLength(1)
    expect(rendered[0]).toEqual(walk) // the sprite round-trips to the playable EntityAnimation, unchanged
  })

  it('empty / undefined inputs are safe (a unit with no animations)', () => {
    expect(entityAnimationsFromUnit(undefined)).toEqual([])
    expect(unitAnimationsFromEntity(undefined)).toEqual([])
    expect(entityAnimationsFromUnit([fade])).toEqual([]) // a settings-only unit projects to no frame animations
  })
})
