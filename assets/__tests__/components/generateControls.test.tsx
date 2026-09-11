/**
 * THE "NEW WORLD" PANEL (was ⚡ GENERATE, §4.6).
 *
 * The menu IS the backend catalog (T-113): every season, kind of place and preset comes from a verbatim
 * capture of `/api/generators`, and the menu offers NOTHING the catalog does not carry. That is the point
 * these tests exist to hold, and it is unchanged.
 *
 * WHAT CHANGED, 2026-09-09, and why this suite was rewritten rather than patched. Alexander asked for four
 * things and each one moved a contract the old tests pinned:
 *
 *  · *"why not just a regular select??? we don't need to have the options showing with scrolling when we
 *    can use an actual dropdown selector and reduce space"* — season chips and map-type cards are now
 *    native `<select>`s, so `getByRole('button', {name: 'winter'})` has no subject.
 *  · *"build this world button should be at the end"* — and it is named that, not "Generate world".
 *  · *"labels aren't clearly descriptive… we need clear concise labeling"* — the numbered
 *    `1 · SEASON` / `4 · MAP SIZE` headings are gone; a control is labelled by what it is.
 *  · *"this shouldn't be a limitation… the previous limits where caused by poor optimization"* — the size
 *    caps were deleted. ONE came back on 2026-09-10 at his own request (*"let's limit maps to 100x100 for
 *    now"*), and it is held to the same standard the removal was: a number is never quietly rewritten under
 *    you. Over the cap the panel SAYS so; it does not silently build something else.
 *
 * Everything else the old suite proved is proved here too: a click selects rather than generates, the
 * picked preset id is forwarded verbatim, and a preset does not survive changing the kind of place.
 *
 * WHAT MOVED OUT, 2026-09-10. Alexander: *"the ground thicknes is not a per template setting, is just a
 * general setting of the grid ... we should add an option in the main sidebar related specifically to the
 * grid ... outside of the template generation"*. The matrix (columns / rows / cell pixels) and the ground
 * thickness are the GRID's, so their tests moved with them to `gridPanel.test.tsx`. This panel takes no
 * size at all now: `onGenerate` has three arguments and the caller reads the grid.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { GenerateControls } from '@/components/game/editorChrome'
import { GENERATOR_LAYERS } from '@/components/game/editorConfig'
import { EMPTY_GENERATOR_CATALOG, catalogZones, categoryLayouts, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)
const noop = () => {}
const SIZE = { cols: 40, rows: 34, cellSize: 16 }

const build = () => fireEvent.click(screen.getByRole('button', { name: /build this world/i }))
const seasons = () => screen.getByLabelText(/^season$/i)
const kinds = () => screen.getByLabelText(/kind of place/i)
/**
 * A preset card, by the name printed on it.
 *
 * The name is ESCAPED before it becomes a regex. "Meadow + River" is a real preset, and `+` is a
 * quantifier — `new RegExp('Meadow + River')` matches "Meadow River" and finds nothing.
 */
const rx = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')

/**
 * Found by its NAME element, exactly, then walked up to the card.
 *
 * A name match is not enough: "Meadow" is a substring of "Meadow + River", so the accessible-name query
 * finds two cards and throws. The `.pn` span holds the name alone.
 */
const preset = (name: string): HTMLElement => {
  const label = screen.getByText(name, { selector: '.pn', exact: true })
  const card = label.closest('button')
  if (!card) throw new Error(`preset "${name}" is not inside a button`)
  return card
}

describe('the menu IS the catalog', () => {
  it('offers a season option for every season the catalog serves, and no others', () => {
    render(<GenerateControls catalog={CATALOG} zone="summer" onZone={noop} onGenerate={noop} />)
    const offered = [...seasons().querySelectorAll('option')].map(o => o.getAttribute('value'))
    expect(offered).toEqual(catalogZones(CATALOG))
    // Two zones the ENGINE knows but this catalog does not serve — the menu must not invent them.
    expect(offered).not.toContain('beach')
    expect(offered).not.toContain('lava')
  })

  it('offers a kind of place for every category, named by the backend', () => {
    render(<GenerateControls catalog={CATALOG} zone="summer" onZone={noop} onGenerate={noop} />)
    const labels = [...kinds().querySelectorAll('option')].map(o => o.textContent ?? '')
    for (const category of CATALOG) {
      expect(labels.some(l => l.startsWith(category.name))).toBe(true)
    }
    expect(labels).toHaveLength(CATALOG.length)
  })

  it('says how many presets each kind offers, so the label carries information', () => {
    render(<GenerateControls catalog={CATALOG} zone="summer" onZone={noop} onGenerate={noop} />)
    const forest = [...kinds().querySelectorAll('option')].find(o => o.textContent?.startsWith('Forest'))
    expect(forest?.textContent).toMatch(new RegExp(`\\(${categoryLayouts(CATALOG, 'forest').length}\\)`))
  })

  it('reports a season change without generating', () => {
    const onZone = jest.fn()
    const onGenerate = jest.fn()
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={onZone} onGenerate={onGenerate} />)
    expect(seasons()).toHaveValue('spring')
    fireEvent.change(seasons(), { target: { value: 'winter' } })
    expect(onZone).toHaveBeenCalledWith('winter')
    expect(onGenerate).not.toHaveBeenCalled()
  })
})

describe('picking is not building — §4.6\'s "why did my map just vanish" trap', () => {
  const setup = () => {
    const onGenerate = jest.fn()
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={onGenerate} />)
    return onGenerate
  }

  it('touches the open map on NO click but the build one', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    expect(onGenerate).not.toHaveBeenCalled()
    const [{ label }] = categoryLayouts(CATALOG, 'forest')
    fireEvent.click(preset(label))
    expect(onGenerate).not.toHaveBeenCalled()
    build()
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('marks the clicked preset as the selection', () => {
    setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    const [, second] = categoryLayouts(CATALOG, 'forest')
    fireEvent.click(preset(second.label))
    expect(preset(second.label)).toHaveAttribute('aria-pressed', 'true')
  })

  it('forwards the picked preset id verbatim — the seam templates.tsx turns into generateStage({layout})', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    const [, second] = categoryLayouts(CATALOG, 'forest')
    fireEvent.click(preset(second.label))
    build()
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', second.id)
  })

  it('builds the category\'s FIRST preset when the kind was chosen but no preset was', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    build()
    const [first] = categoryLayouts(CATALOG, 'forest')
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', first.id)
  })

  it('passes NO preset for a kind that has none, and hides the preset group', () => {
    const onGenerate = setup()
    const bare = CATALOG.find(c => categoryLayouts(CATALOG, c.key).length === 0)
    if (!bare) return // every category in the fixture has presets; nothing to assert
    fireEvent.change(kinds(), { target: { value: bare.key } })
    expect(screen.queryByText(/^which /i)).not.toBeInTheDocument()
    build()
    expect(onGenerate).toHaveBeenCalledWith('spring', bare.key, undefined)
  })

  it('does NOT carry a preset across kinds of place', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    const [, second] = categoryLayouts(CATALOG, 'forest')
    fireEvent.click(preset(second.label))
    const other = CATALOG.find(c => c.key !== 'forest' && categoryLayouts(CATALOG, c.key).length > 0)
    if (!other) return
    fireEvent.change(kinds(), { target: { value: other.key } })
    build()
    const [firstOfOther] = categoryLayouts(CATALOG, other.key)
    expect(onGenerate).toHaveBeenCalledWith('spring', other.key, firstOfOther.id)
  })
})

describe('an empty or failed catalog says so instead of offering nothing', () => {
  it('offers no kinds and no build button while the catalog is empty', () => {
    render(<GenerateControls catalog={EMPTY_GENERATOR_CATALOG} zone="spring" onZone={noop} onGenerate={noop} />)
    expect(screen.queryByLabelText(/kind of place/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /build this world/i })).not.toBeInTheDocument()
  })

  it('says the generators are loading when nothing has failed yet', () => {
    render(<GenerateControls catalog={EMPTY_GENERATOR_CATALOG} zone="spring" onZone={noop} onGenerate={noop} />)
    expect(screen.getByText(/loading the map generators/i)).toBeInTheDocument()
  })

  it('names the failure when the load failed, instead of an empty menu', () => {
    render(
      <GenerateControls catalog={EMPTY_GENERATOR_CATALOG} catalogError="offline" zone="spring"
        onZone={noop} onGenerate={noop} />,
    )
    expect(screen.getByText(/offline/i)).toBeInTheDocument()
  })
})

describe('rebuild ONE part, keep the rest', () => {
  it('shows every generator layer, and the SAME set for every kind of place', () => {
    const onRandomizeLayer = jest.fn()
    render(
      <GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop}
        onRandomizeLayer={onRandomizeLayer} />,
    )
    for (const { label } of GENERATOR_LAYERS) {
      expect(screen.getByRole('button', { name: new RegExp(label, 'i') })).toBeInTheDocument()
    }
  })

  it('forwards the clicked layer id (data-driven, no per-id branch)', () => {
    const onRandomizeLayer = jest.fn()
    render(
      <GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop}
        onRandomizeLayer={onRandomizeLayer} />,
    )
    for (const { id, label } of GENERATOR_LAYERS) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(label, 'i') }))
      expect(onRandomizeLayer).toHaveBeenCalledWith(id)
    }
  })

  it('hides the layer row entirely when no handler is wired (no current map to scope)', () => {
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop} />)
    expect(screen.queryByText(/rebuild one part/i)).not.toBeInTheDocument()
  })
})

describe('re-roll the selection — it names the count and says what to do first', () => {
  it('names how many tiles it will touch', () => {
    render(
      <GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop}
        selectedCount={7} onRandomizeSelection={noop} />,
    )
    expect(screen.getByRole('button', { name: /7 selected tiles/i })).toBeInTheDocument()
  })

  it('offers the missing prerequisite instead of only disabling itself', () => {
    render(
      <GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop}
        selectedCount={0} onRandomizeSelection={noop} />,
    )
    expect(screen.getByText(/select some cells on the map first/i)).toBeInTheDocument()
  })
})
