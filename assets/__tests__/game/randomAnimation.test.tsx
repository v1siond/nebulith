/**
 * RANDOM animation authoring (Alexander: "select a unit, click animate and add a random animation (movement)
 * or build one manually like we do now" + the top-nav "Animated" placement drops one on automatically).
 *
 *   1. randomMovementAnimation() — the DATA a "random" drop produces: a `move`-triggered, any-direction walk
 *      cycle (own tile → mirrored) with a randomized cadence. Deterministic under an injected rng.
 *   2. The Animate modal's 🎲 button appends that as a sprite-kind animation (editable like any other row).
 */
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { TileAnimationEditor } from '@/components/game/editorChrome'
import { randomMovementAnimation } from '@/game/runtime/entityAnimation'
import type { Animation } from '@/engine/animation/tileAnimation'

describe('randomMovementAnimation() — the DATA a random drop produces', () => {
  it('is a move-triggered, any-direction, looping walk cycle (own tile → mirrored)', () => {
    const anim = randomMovementAnimation(() => 0)
    expect(anim.trigger).toEqual({ on: 'move' })
    expect(anim.direction).toBe('any')
    expect(anim.loop).toBe(true)
    // frame 0 = the entity's OWN tile (empty), frame 1 = the same tile MIRRORED → a visible step.
    expect(anim.frames).toHaveLength(2)
    expect(anim.frames[0]).toEqual({})
    expect(anim.frames[1]).toEqual({ flipX: true })
    // cadence is randomized within a sane 260–520ms band.
    expect(anim.durationMs).toBeGreaterThanOrEqual(260)
    expect(anim.durationMs).toBeLessThanOrEqual(520)
  })

  it('randomizes the cadence off the injected rng (different rolls differ)', () => {
    expect(randomMovementAnimation(() => 0).durationMs).toBe(260)
    expect(randomMovementAnimation(() => 0.999).durationMs).toBe(519)
  })

  it('mints unique ids so two rolls never collide in a list', () => {
    const a = randomMovementAnimation()
    const b = randomMovementAnimation()
    expect(a.id).not.toBe(b.id)
  })
})

/** A controlled consumer mirroring the written list as JSON so the test reads the DATA a click produced. */
function Harness({ kinds }: { kinds?: readonly ('settings' | 'sprite')[] }) {
  const [anims, setAnims] = useState<Animation[]>([])
  return (
    <>
      <TileAnimationEditor
        animations={anims}
        elementType="Character"
        elementLabel="goblin"
        spriteContext={{ category: 'units', styleId: 'emoji', baseVisual: { kind: 'glyph', char: '👺' } }}
        kinds={kinds}
        onChange={setAnims}
      />
      <pre data-testid="state">{JSON.stringify(anims)}</pre>
    </>
  )
}
const readState = (): Animation[] => JSON.parse(screen.getByTestId('state').textContent || '[]')

describe('Animate modal — the 🎲 Random button appends a random movement animation', () => {
  it('a unit modal (kinds=[sprite]) offers the random add, and it writes a sprite move cycle', () => {
    render(<Harness kinds={['sprite']} />)
    const random = screen.getByRole('button', { name: /Add random animation/i })
    expect(random).toBeInTheDocument()
    fireEvent.click(random)
    const state = readState()
    expect(state).toHaveLength(1)
    const s = state[0] as Extract<Animation, { kind: 'sprite' }>
    expect(s.kind).toBe('sprite')
    expect(s.spriteTrigger?.on).toBe('move')
    expect(s.frames).toHaveLength(2)
    expect(s.frames[1]).toEqual({ flipX: true })
  })

  it('appends alongside a manually-built one (random OR manual — both coexist and are editable)', () => {
    render(<Harness kinds={['sprite']} />)
    fireEvent.click(screen.getByRole('button', { name: /Add sprite animation/i })) // manual
    fireEvent.click(screen.getByRole('button', { name: /Add random animation/i })) // random
    expect(readState()).toHaveLength(2)
    expect(readState().every(a => a.kind === 'sprite')).toBe(true)
  })
})
