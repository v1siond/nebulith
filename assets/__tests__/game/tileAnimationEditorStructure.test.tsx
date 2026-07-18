/**
 * TILE animation editor STRUCTURE + behaviour (Phase 4). The dedicated modal body that authors
 * `GridAsset.animations` for ONE selected tile must:
 *   1. HEADER — clearly name the element TYPE (Tile vs Character) so it's unmistakable what's being animated.
 *   2. ADD — "Add settings animation" appends a `kind:'settings'` envelope (Sprite is a labeled STUB).
 *   3. FIELDS — each animation exposes the settings MULTI-PICKER (a checkbox per SettingKey), from/to per
 *      checked setting, duration / start delay / loop delay / loop / ease / trigger (+radius on proximity),
 *      and style/view scope chips.
 *   4. WRITE-THROUGH — checking opacity + y and typing from/to writes the RIGHT asset.animations shape (the
 *      fountain water: an opacity 0→1 + y 0→3 settings track over a duration). This is the load-bearing test.
 *
 * A controlled Harness holds the list so successive edits accumulate (a real onChange consumer), and the
 * current shape is mirrored into a <pre> we parse — asserting the DATA written, not just that a control exists.
 */
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TileAnimationEditor } from '@/components/game/editorChrome'
import type { Animation } from '@/engine/animation/tileAnimation'

/** A controlled consumer: holds the animation list + mirrors it as JSON so a test can read the written shape. */
function Harness({ initial = [], elementType = 'Tile' as const }: { initial?: Animation[]; elementType?: 'Tile' | 'Character' }) {
  const [anims, setAnims] = useState<Animation[]>(initial)
  return (
    <>
      <TileAnimationEditor animations={anims} elementType={elementType} elementLabel="water_c" onChange={setAnims} />
      <pre data-testid="state">{JSON.stringify(anims)}</pre>
    </>
  )
}

const readState = (): Animation[] => JSON.parse(screen.getByTestId('state').textContent || '[]')

/** A settings animation with opacity + y tracks already present (for the field-existence assertions). */
function fountainDraft(): Animation {
  return {
    id: 'a0',
    name: 'rise',
    kind: 'settings',
    tracks: [
      { setting: 'opacity', from: 0, to: 1 },
      { setting: 'y', from: 0, to: 3 },
    ],
    durationMs: 1200,
    startDelayMs: 0,
    loopDelayMs: 600,
    loop: true,
    ease: 'sine',
    priority: 1,
    trigger: { on: 'load' },
  }
}

describe('TileAnimationEditor — header + empty state', () => {
  it('the header names the element TYPE (Tile) and label', () => {
    render(<Harness />)
    expect(screen.getByText(/✦ Tile animation/i)).toBeInTheDocument()
    expect(screen.getByText('water_c')).toBeInTheDocument()
  })

  it('a Character element shows a Character header (type is not hard-coded to Tile)', () => {
    render(<Harness elementType="Character" />)
    expect(screen.getByText(/✦ Character animation/i)).toBeInTheDocument()
  })

  it('with no animations it shows the empty-state hint + a live preview region', () => {
    render(<Harness />)
    expect(screen.getByText(/No animations yet/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Animation preview')).toBeInTheDocument()
  })
})

describe('TileAnimationEditor — add / kind', () => {
  it('"Add settings animation" appends ONE kind:settings envelope with empty tracks + load trigger', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Add settings animation/i }))
    const state = readState()
    expect(state).toHaveLength(1)
    expect(state[0].kind).toBe('settings')
    expect((state[0] as { tracks: unknown[] }).tracks).toEqual([])
    expect(state[0].trigger).toEqual({ on: 'load' })
  })

  it('the Sprite path is a LABELED stub (present but disabled — not authorable this phase)', () => {
    render(<Harness />)
    const sprite = screen.getByRole('button', { name: /Add sprite animation/i })
    expect(sprite).toBeDisabled()
    expect(sprite).toHaveTextContent(/soon/i)
  })
})

describe('TileAnimationEditor — an animation row exposes every field', () => {
  beforeEach(() => render(<Harness initial={[fountainDraft()]} />))

  it('renders the settings MULTI-PICKER — a checkbox per SettingKey (opacity, y, color, display…)', () => {
    for (const key of ['opacity', 'y', 'x', 'zoom', 'width', 'height', 'color', 'display', 'zIndex']) {
      expect(screen.getByLabelText(`animate ${key}`)).toBeInTheDocument()
    }
    // opacity + y are checked (the draft has those tracks); an unpicked one (zoom) is not.
    expect(screen.getByLabelText('animate opacity')).toBeChecked()
    expect(screen.getByLabelText('animate y')).toBeChecked()
    expect(screen.getByLabelText('animate zoom')).not.toBeChecked()
  })

  it('renders from/to for each CHECKED setting only', () => {
    expect(screen.getByLabelText('opacity from')).toHaveValue(0)
    expect(screen.getByLabelText('opacity to')).toHaveValue(1)
    expect(screen.getByLabelText('y from')).toHaveValue(0)
    expect(screen.getByLabelText('y to')).toHaveValue(3)
    // zoom is not checked → it has no from/to row.
    expect(screen.queryByLabelText('zoom from')).toBeNull()
  })

  it('renders timing (duration/start/loop delay/loop/ease/priority), the trigger, and scope chips', () => {
    expect(screen.getByLabelText('duration')).toHaveValue(1200)
    expect(screen.getByLabelText('start delay')).toHaveValue(0)
    expect(screen.getByLabelText('loop delay')).toHaveValue(600)
    expect(screen.getByLabelText('loop')).toBeChecked()
    expect(screen.getByLabelText('ease')).toHaveValue('sine')
    expect(screen.getByLabelText('priority')).toHaveValue(1)
    expect(screen.getByLabelText('trigger')).toHaveValue('load')
    // scope chips for both styles and all three views.
    for (const chip of ['ascii', 'emoji', 'iso', '2d', 'top']) {
      expect(screen.getByRole('button', { name: `scope ${chip}` })).toBeInTheDocument()
    }
  })

  it('choosing the proximity trigger reveals a radius input', () => {
    expect(screen.queryByLabelText('proximity radius')).toBeNull()
    fireEvent.change(screen.getByLabelText('trigger'), { target: { value: 'proximity' } })
    expect(screen.getByLabelText('proximity radius')).toBeInTheDocument()
  })
})

describe('TileAnimationEditor — manual authoring writes the right asset.animations shape', () => {
  it('add → check opacity + y → type from/to → produces the fountain settings track', () => {
    render(<Harness />)

    // Add a fresh settings animation, then MULTI-PICK opacity + y.
    fireEvent.click(screen.getByRole('button', { name: /Add settings animation/i }))
    fireEvent.click(screen.getByLabelText('animate opacity'))
    fireEvent.click(screen.getByLabelText('animate y'))

    // Type the fountain endpoints: opacity 0→1, y 0→3.
    fireEvent.change(screen.getByLabelText('opacity from'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('opacity to'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('y from'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('y to'), { target: { value: '3' } })
    // Fountain-like timing.
    fireEvent.change(screen.getByLabelText('duration'), { target: { value: '1200' } })
    fireEvent.change(screen.getByLabelText('loop delay'), { target: { value: '600' } })

    const anims = readState()
    expect(anims).toHaveLength(1)
    const a = anims[0] as Extract<Animation, { kind: 'settings' }>
    expect(a.kind).toBe('settings')
    expect(a.durationMs).toBe(1200)
    expect(a.loopDelayMs).toBe(600)
    expect(a.loop).toBe(true)
    // The tracks are exactly opacity 0→1 and y 0→3 (order-independent).
    expect(a.tracks).toEqual(
      expect.arrayContaining([
        { setting: 'opacity', from: 0, to: 1 },
        { setting: 'y', from: 0, to: 3 },
      ]),
    )
    expect(a.tracks).toHaveLength(2)
  })

  it('unchecking a setting removes its track (multi-picker is a real toggle)', () => {
    render(<Harness initial={[fountainDraft()]} />)
    expect((readState()[0] as { tracks: unknown[] }).tracks).toHaveLength(2)
    fireEvent.click(screen.getByLabelText('animate y')) // uncheck y
    const tracks = (readState()[0] as { tracks: { setting: string }[] }).tracks
    expect(tracks).toHaveLength(1)
    expect(tracks[0].setting).toBe('opacity')
  })

  it('a scope chip limits the animation to that style/view (empty = all)', () => {
    render(<Harness initial={[fountainDraft()]} />)
    expect((readState()[0] as { scope?: unknown }).scope).toBeUndefined() // starts "all"
    fireEvent.click(screen.getByRole('button', { name: 'scope iso' }))
    expect((readState()[0] as { scope: { views: string[] } }).scope.views).toEqual(['iso'])
    // toggling the last view back off drops scope entirely (back to "all").
    fireEvent.click(screen.getByRole('button', { name: 'scope iso' }))
    expect((readState()[0] as { scope?: unknown }).scope).toBeUndefined()
  })

  it('deleting an animation removes it from the list', () => {
    render(<Harness initial={[fountainDraft()]} />)
    expect(readState()).toHaveLength(1)
    fireEvent.click(within(screen.getByLabelText('Animation name').closest('div')!).getByLabelText('Delete animation'))
    expect(readState()).toHaveLength(0)
  })
})
