/**
 * THE LEFT RAIL — one idiom for everything you place, banded by the journey.
 *
 * Re-pointed at the approved design (:8899, "PROPOSED — interactive, try it"), which changed the rail's
 * MODEL, not just its paint. Three deliberate differences from the old `EDITOR_RAIL`, each asserted below
 * because each was a decision:
 *
 *  · **`select` is gone.** Grouping actions by the OBJECT they act on showed it acts on nothing — it is the
 *    resting state of the cursor. When no brush is armed, clicking selects; that needs no button.
 *  · **`artstyle` is gone from the rail.** Alexander, 2026-09-08: *"I think art style should be on top nav
 *    before game selector."* It is the skin the whole product wears, not a step in building a level.
 *  · **`hud` is new** — the player's UI, which had no home in the editor at all.
 *
 * Plus: the rail is the ONLY place the three libraries are named (the panel's duplicate tab strip is gone —
 * *"why do we have tiles, objects and characters repeated in the sidebar and inside tile sectrion?"*), and
 * each library row carries its COUNT so the label has information scent.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { ToolRail } from '@/components/game/editorChrome'
import { EDITOR_BANDS, EDITOR_RAIL } from '@/components/game/editorConfig'

const ENTRIES = EDITOR_BANDS.flatMap(band => band.items)

const setup = (activeId: string = 'terrain', extra: Partial<Parameters<typeof ToolRail>[0]> = {}) => {
  const onPick = jest.fn()
  render(<ToolRail activeId={activeId as never} onPick={onPick} {...extra} />)
  return onPick
}

describe('the rail renders the MODEL, not a hand-written subset', () => {
  it('shows a button for every entry the bands declare', () => {
    setup()
    for (const entry of ENTRIES) {
      expect(screen.getByRole('tab', { name: new RegExp(entry.label, 'i') })).toBeInTheDocument()
    }
  })

  it('groups them under the three band headings, in journey order', () => {
    const { container } = render(<ToolRail activeId={'terrain' as never} onPick={jest.fn()} />)
    const headings = [...container.querySelectorAll('.zn')].map(n => n.textContent)
    expect(headings).toEqual(['MAKE THE WORLD', 'PUT THINGS IN IT', 'MAKE IT A GAME'])
  })

  it('leads with New world — it is the first thing anyone does with an empty map', () => {
    expect(EDITOR_BANDS[0].items[0].id).toBe('generate')
    expect(EDITOR_BANDS[0].items[0].label).toBe('New world')
  })

  it('names the three libraries, and names them only here', () => {
    setup()
    for (const label of ['Tiles', 'Objects', 'Characters']) {
      expect(screen.getByRole('tab', { name: new RegExp(label, 'i') })).toBeInTheDocument()
    }
  })

  it('offers the player’s UI, which the old rail had no entry for', () => {
    setup()
    expect(screen.getByRole('tab', { name: /player ui/i })).toBeInTheDocument()
    expect(EDITOR_RAIL.some(e => e.id === 'hud')).toBe(false)
  })

  it('drops Select — it acts on no object, so it is not a tool', () => {
    setup()
    expect(ENTRIES.some(e => e.id === 'select')).toBe(false)
    expect(screen.queryByRole('tab', { name: /^select$/i })).not.toBeInTheDocument()
  })

  it('drops Art style — it moved to the top nav, before the game selector', () => {
    setup()
    expect(ENTRIES.some(e => e.id === 'artstyle')).toBe(false)
    expect(screen.queryByRole('tab', { name: /art style/i })).not.toBeInTheDocument()
  })

  it('carries each entry’s plain-language hint, so the rail teaches', () => {
    setup()
    const tiles = ENTRIES.find(e => e.id === 'terrain')!
    expect(screen.getByRole('tab', { name: new RegExp(tiles.label, 'i') })).toHaveAttribute('title', tiles.hint)
  })
})

describe('the counts give each library label information scent', () => {
  it('shows the count beside a library it was given one for', () => {
    setup('terrain', { counts: { terrain: 238, objects: 23, characters: 67 } })
    expect(screen.getByRole('tab', { name: /tiles/i })).toHaveTextContent('238')
    expect(screen.getByRole('tab', { name: /objects/i })).toHaveTextContent('23')
    expect(screen.getByRole('tab', { name: /characters/i })).toHaveTextContent('67')
  })

  it('shows no count for the rows that are not libraries', () => {
    setup('terrain', { counts: { terrain: 238 } })
    expect(screen.getByRole('tab', { name: /new world/i })).not.toHaveTextContent(/\d/)
    expect(screen.getByRole('tab', { name: /rules/i })).not.toHaveTextContent(/\d/)
  })

  it('omits the count entirely before the catalog has loaded', () => {
    setup('terrain')
    expect(screen.getByRole('tab', { name: /tiles/i })).not.toHaveTextContent(/\d/)
  })
})

describe('selection', () => {
  it('announces the active entry', () => {
    setup('characters')
    expect(screen.getByRole('tab', { name: /characters/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /tiles/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('announces the player’s UI as selected while its MODE is on, whatever the rail id says', () => {
    setup('terrain', { hudActive: true })
    expect(screen.getByRole('tab', { name: /player ui/i })).toHaveAttribute('aria-selected', 'true')
    // …and nothing else is, because the mode replaces the panel.
    expect(screen.getByRole('tab', { name: /tiles/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('reports the ENTRY that was picked — New world and Rules arm no tool', () => {
    const onPick = setup()
    fireEvent.click(screen.getByRole('tab', { name: /new world/i }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'generate', mode: null }))
  })

  it('reports a library entry with the tool it arms', () => {
    const onPick = setup()
    fireEvent.click(screen.getByRole('tab', { name: /characters/i }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'characters', mode: 'unit' }))
  })
})

describe('the zone owns the chrome when the rail is rendered bare', () => {
  it('renders no zone element of its own, so the caller can wrap it with a collapse handle', () => {
    const { container } = render(<ToolRail activeId={'terrain' as never} onPick={jest.fn()} bare />)
    expect(container.querySelector('.z-rail')).toBeNull()
    expect(container.querySelector('.railbands')).toBeInTheDocument()
  })

  it('still renders every entry when bare', () => {
    render(<ToolRail activeId={'terrain' as never} onPick={jest.fn()} bare />)
    for (const entry of ENTRIES) {
      expect(screen.getByRole('tab', { name: new RegExp(entry.label, 'i') })).toBeInTheDocument()
    }
  })
})
