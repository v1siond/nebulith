/**
 * THE "NEW WORLD" PANEL (was ⚡ GENERATE, §4.6).
 *
 * The menu IS the backend catalog (T-113): every season, kind of place and preset comes from a verbatim
 * capture of `/api/generators`, and the menu offers NOTHING the catalog does not carry. That is the point
 * these tests exist to hold, and it is unchanged.
 *
 * WHAT CHANGED, 2026-09-09, and why this suite was rewritten rather than patched. The ask was for four
 * things and each one moved a contract the old tests pinned:
 *
 * · — season chips and map-type cards are now
 *    native `<select>`s, so `getByRole('button', {name: 'winter'})` has no subject.
 * · — and it is named that, not "Generate world".
 * · — the numbered
 *    `1 · SEASON` / `4 · MAP SIZE` headings are gone; a control is labelled by what it is.
 * · — the size
 * caps were deleted. ONE came back on 2026-09-10 at request (), and it is held to the same standard the
  * removal was: a number is never quietly rewritten under
 *    you. Over the cap the panel SAYS so; it does not silently build something else.
 *
 * Everything else the old suite proved is proved here too: a click selects rather than generates, the
 * picked preset id is forwarded verbatim, and a preset does not survive changing the kind of place.
 *
 * WHAT MOVED OUT, 2026-09-10. The matrix (columns / rows / cell pixels) and the ground
 * thickness are the GRID's, so their tests moved with them to `gridPanel.test.tsx`. This panel takes no
 * size at all now: `onGenerate` has three arguments and the caller reads the grid.
 */
import { act, render, screen, fireEvent, within } from '@testing-library/react'
import { GenerateControls } from '@/components/game/editorChrome'
import { installGenerationLayers } from '@/engine/generate/generationLayers'
import { generatorLayers } from '@/components/game/editorConfig'
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
    // `second` is the Jungle, and a jungle carries the region picker, so its build says which region leads.
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', second.id, { exits: 'random', pathways: 'random', upTo: 'objects', region: 'random', river: 'none', depth: 'none', bridge: 'none' })
  })

  it('builds the category\'s FIRST preset when the kind was chosen but no preset was', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    build()
    const [first] = categoryLayouts(CATALOG, 'forest')
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', first.id, { exits: 'random', pathways: 'random', upTo: 'objects', river: 'none', depth: 'none', bridge: 'none' })
  })

  it('passes NO preset for a kind that has none, and hides the preset group', () => {
    const onGenerate = setup()
    const bare = CATALOG.find(c => categoryLayouts(CATALOG, c.key).length === 0)
    if (!bare) return // every category in the fixture has presets; nothing to assert
    fireEvent.change(kinds(), { target: { value: bare.key } })
    expect(screen.queryByText(/^which /i)).not.toBeInTheDocument()
    build()
    expect(onGenerate).toHaveBeenCalledWith('spring', bare.key, undefined, { exits: 'random', pathways: 'random' })
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
    // The options sent are that kind of place's OWN defaults, not the ones the previous pick carried. A town
    // serves pathways now, so it sends its own `random` pathways rather than the empty map this used to expect: what
    // matters is that nothing came ACROSS from the kind of place clicked before.
    const [, , layout, options] = onGenerate.mock.calls[onGenerate.mock.calls.length - 1]
    expect(layout).toBe(firstOfOther.id)
    // ITS OWN DEFAULTS, WITH THE DEPENDENCIES HONOURED. An option that declares `requires` is OFF while the
    // one it names is off, which is the panel's whole dependency contract, so reading the raw `default` off
    // every row and expecting that to be sent describes a panel that ignores it.
    const rows = other.generators[0].options ?? []
    const stated = Object.fromEntries(rows.map(o => [o.key, o.default]).filter(([, d]) => d !== undefined))
    const ownDefaults = Object.fromEntries(
      Object.entries(stated).map(([key, value]) => {
        const requires = rows.find(o => o.key === key)?.requires
        const off = requires !== undefined && (stated[requires] === 'none' || stated[requires] === false)
        return [key, off ? 'none' : value]
      }),
    )
    expect(options).toEqual(ownDefaults)
  })
})

describe('variations are options on a preset, not more presets', () => {
  const control = (label: RegExp | string) => screen.getByLabelText(label) as HTMLInputElement & HTMLSelectElement
  const setup = () => {
    const onGenerate = jest.fn()
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={onGenerate} />)
    return onGenerate
  }

  it('offers the river as a choice of COURSE — each one he named, random among them', () => {
    setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    expect([...control(/^river$/i).options].map(o => o.value)).toEqual(['none', 'random', 'through', 'divides', 'around'])
  })

  it('forwards the course that was picked, so a river never needs a row of its own', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    fireEvent.change(control(/^river$/i), { target: { value: 'divides' } })
    build()
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', expect.any(String), { exits: 'random', pathways: 'random', upTo: 'objects', river: 'divides', depth: '1', bridge: 'random' })
  })


  // THE `crossing` TOGGLE IS GONE ("'A crossing joined to the paths' what does even mean???? I don't know
  // why we have it in the UI"), and the test that pinned it went with it. The rule it covered, that an option
  // declaring `requires: "river"` is off without one, is the subject of the two below.
  it('offers the kind of crossing, greyed out until there is a river, and forwards the one picked', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    const kind = () => control(/^kind of crossing$/i)
    expect([...kind().options].map(o => o.value)).toEqual(['random', 'dirt', 'wood', 'planks', 'stone'])
    expect(kind().disabled).toBe(true)
    fireEvent.change(control(/^river$/i), { target: { value: 'divides' } })
    expect(kind().disabled).toBe(false)
    fireEvent.change(kind(), { target: { value: 'stone' } })
    build()
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', expect.any(String), { exits: 'random', pathways: 'random', upTo: 'objects', river: 'divides', depth: '1', bridge: 'stone' })
  })

  it('offers HOW DEEP the channel is cut, greyed out until there is a river, and forwards it', () => {
    // and Same shape as the crossing and its kind: served, dependent, forwarded. A variation is an
    // option, so it gets the same coverage the other options have.
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    const depth = () => control(/how deep the channel is cut/i)

    expect([...depth().options].map(o => o.value)).toEqual(['1', '2']) // not-cut is the off value, not a choice
    expect(depth().disabled).toBe(true) // nothing to cut without a river
    fireEvent.change(control(/^river$/i), { target: { value: 'divides' } })
    expect(depth().disabled).toBe(false)
    fireEvent.change(depth(), { target: { value: '2' } })
    build()
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', expect.any(String), { exits: 'random', pathways: 'random', upTo: 'objects', river: 'divides', depth: '2', bridge: 'random' })
  })

  it('offers nothing to switch on for a kind of place that has no options', () => {
    setup()
    fireEvent.change(kinds(), { target: { value: 'cave' } })
    expect(screen.queryByText(/anything else/i)).toBeNull()
    expect(screen.queryByLabelText(/^river$/i)).toBeNull()
  })
})

describe('forest > type > subtype — pick one, go deeper, or randomize', () => {
  const setup = () => {
    const onGenerate = jest.fn()
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={onGenerate} />)
    return onGenerate
  }
  // Labelled by the thing it picks, not by a question: "Preset", not "which forest?".
  const which = (name: string) => screen.getByLabelText(new RegExp(`^${name}$`, 'i')) as HTMLSelectElement
  const WOODLANDS = ['forest_woodland_beech', 'forest_woodland_dense', 'forest_woodland_mountain', 'forest_woodland_glades']

  it('offers the woodland\'s own standard version, every subtype, and Random', () => {
    setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    fireEvent.click(preset('Woodland'))
    expect([...which('woodland').options].map(o => o.value)).toEqual(['', ...WOODLANDS, 'random'])
  })

  it('builds exactly the subtype that was picked', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    fireEvent.click(preset('Woodland'))
    fireEvent.change(which('woodland'), { target: { value: 'forest_woodland_mountain' } })
    build()
    // The mountain forest carries REGIONS now (ridge, slope and vale, at three different levels), so like the
    // jungle above it offers a region picker, and its served default is random. Nothing here is invented: the
    // key appears because the row's own options say it does.
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', 'woodland', { exits: 'random', pathways: 'random', upTo: 'objects', region: 'random', river: 'none', depth: 'none', bridge: 'none' }, 'forest_woodland_mountain')
  })

  it('Random builds one of the subtypes, rolled on the build itself', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    fireEvent.click(preset('Woodland'))
    fireEvent.change(which('woodland'), { target: { value: 'random' } })
    build()
    expect(WOODLANDS).toContain(onGenerate.mock.calls[0][4])
  })

  it('the standard version sends no subtype — exactly the call it always made', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    fireEvent.click(preset('Woodland'))
    build()
    expect(onGenerate.mock.calls[0]).toHaveLength(4)
  })

  it('a jungle offers the REGION that leads it, and forwards the one picked', () => {
    // Variations are offered as a picker, the same as the jungle and the region, not as tick boxes.
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    fireEvent.click(preset('Jungle'))
    const region = screen.getByLabelText(/^region$/i) as HTMLSelectElement
    expect([...region.options].map(o => o.value)).toEqual(['random', 'open', 'dense', 'swamp', 'ruins'])

    fireEvent.change(region, { target: { value: 'swamp' } })
    build()
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', 'jungle', { exits: 'random', pathways: 'random', upTo: 'objects', region: 'swamp', river: 'none', depth: 'none', bridge: 'none' })
  })

  it('a subtype offers only the regions it carries', () => {
    setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    fireEvent.click(preset('Jungle'))
    fireEvent.change(which('jungle'), { target: { value: 'forest_jungle_dense' } })
    const region = screen.getByLabelText(/^region$/i) as HTMLSelectElement
    expect([...region.options].map(o => o.value)).toEqual(['random', 'open', 'dense'])
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
  // THE LAYERS ARE SERVED, so the panel is driven by a mocked backend body rather than by a list this file
  // keeps: *"on the tests side we must mock the backend response and return and assert as many layers we
  // want"*. `fog` is in here on purpose — a layer the backend invents after this file was written must show
  // up without anyone editing this file.
  const SERVED = {
    generationLayers: [
      { key: 'pathways', label: 'Pathways', hint: 'the exits and the paths between them', position: 10, seedable: true },
      { key: 'layout', label: 'Layout', hint: 'the bare shape', position: 20, seedable: true },
      { key: 'gates', label: 'Gates', hint: 'follows the pathways', position: 25, seedable: false },
      { key: 'fog', label: 'Fog', hint: 'a fog pass', position: 30, seedable: true },
    ],
  }
  beforeEach(() => installGenerationLayers(SERVED))
  afterEach(() => installGenerationLayers({ generationLayers: [] }))

  it('shows every SEEDABLE layer the backend serves, and the same set for every kind of place', () => {
    const onRandomizeLayer = jest.fn()
    render(
      <GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop}
        onRandomizeLayer={onRandomizeLayer} />,
    )
    for (const { label } of generatorLayers()) {
      expect(screen.getByRole('button', { name: new RegExp(label, 'i') })).toBeInTheDocument()
    }
    // …and the one that only follows is NOT offered, because rolling it would do nothing.
    expect(screen.queryByRole('button', { name: /^gates$/i })).toBeNull()
  })

  it('forwards the clicked layer id (data-driven, no per-id branch)', () => {
    const onRandomizeLayer = jest.fn()
    render(
      <GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop}
        onRandomizeLayer={onRandomizeLayer} />,
    )
    for (const { id, label } of generatorLayers()) {
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

describe('the preview window shows the world to build, its size, and the options that shape it', () => {
  const size = { cols: 60, rows: 40, cellSize: 16 }
  type Props = Parameters<typeof GenerateControls>[0]
  const props = (extra: Partial<Props> = {}): Props => ({
    catalog: CATALOG, zone: 'spring', onZone: noop, onGenerate: jest.fn(), onPeek: jest.fn(),
    sizeDraft: size, size, onSizeDraft: noop, onResize: noop, ...extra,
  })
  const lastPeek = (onPeek: jest.Mock) => onPeek.mock.calls[onPeek.mock.calls.length - 1][0]
  const slots: HTMLElement[] = []
  const slot = () => { const el = document.body.appendChild(document.createElement('div')); slots.push(el); return el }
  afterEach(() => { slots.splice(0).forEach(el => el.remove()) })

  it('peeks the selected world the moment the panel opens, at the size it will be built', () => {
    const p = props()
    render(<GenerateControls {...p} />)
    expect(lastPeek(p.onPeek as jest.Mock)).toMatchObject({ kind: 'stage', zone: 'spring', variant: CATALOG[0].key, cols: 60, rows: 40 })
  })

  it('a new season re-peeks on its own, no hover needed', () => {
    const p = props()
    const { rerender } = render(<GenerateControls {...p} />)
    rerender(<GenerateControls {...p} zone="winter" />)
    expect(lastPeek(p.onPeek as jest.Mock)).toMatchObject({ zone: 'winter', cols: 60, rows: 40 })
  })

  it('the picture is the map at the size it will be built, up to the largest map there is', () => {
    const big = { cols: 100, rows: 80, cellSize: 12 }
    const into = slot()
    const p = props({ sizeDraft: big, size: big, tuningSlot: into })
    render(<GenerateControls {...p} />)
    expect(lastPeek(p.onPeek as jest.Mock)).toMatchObject({ cols: 100, rows: 80 })
    expect(into.textContent).toContain('100 × 80 = 8,000 cells, 12px each')
  })

  it('with a preview window, the options and the size live in it, and the build button stays in the panel', () => {
    const into = slot()
    const p = props({ tuningSlot: into })
    const { container } = render(<GenerateControls {...p} />)
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    expect(within(into).getByLabelText(/^river$/i)).toBeInTheDocument()
    expect(within(into).getByLabelText(/^kind of crossing$/i)).toBeInTheDocument()
    expect(within(into).getByLabelText(/^map columns$/i)).toBeInTheDocument()
    expect(within(into).getByLabelText(/^season$/i)).toBeInTheDocument() // the season shapes the world, so it travels too
    expect(into.textContent).toContain('60 × 40 = 2,400 cells, 16px each')
    expect(within(container).queryByLabelText(/^river$/i)).toBeNull()
    expect(within(container).getByRole('button', { name: /build this world/i })).toBeInTheDocument()
    expect(within(into).queryByRole('button', { name: /build this world/i })).toBeNull()
    // the place itself is still picked in the panel
    expect(within(container).getByLabelText(/kind of place/i)).toBeInTheDocument()
  })

  /**
   * The subject carried the CATEGORY key as the archetype. That is an archetype by coincidence for forest,
   * cave and temple, and never was for "settlement" since town and city were merged under it, so the engine
   * ran no pass and the preview drew an empty grid. Only settlements broke, and the one test that looked at
   * this field asserted `CATALOG[0].key` where the key and the variant happen to be the same word, so nothing
   * caught it.
   */
  it('a settlement peeks the ROW\'s archetype, never the category key', () => {
    const p = props()
    render(<GenerateControls {...p} />)
    fireEvent.change(kinds(), { target: { value: 'settlement' } })
    const peek = lastPeek(p.onPeek as jest.Mock)
    expect(peek.variant).toBe('town') // the first settlement KIND is a town
    expect(peek.variant).not.toBe('settlement') // which is not an archetype the engine builds
    expect(peek).toMatchObject({ kind: 'stage', layout: 'town' })
  })

  /**
   * With no window to portal into, the options fall back inline (that is
   * the sidebar half), and nothing could ask for the window back.
   */
  describe('the way back to the preview window', () => {
    const reopen = () => screen.getByRole('button', { name: /preview window/i })

    it('offers it exactly when the options have fallen back into the sidebar', () => {
      render(<GenerateControls {...props({ onOpenPreview: jest.fn() })} />)
      expect(reopen()).toBeInTheDocument()
    })

    it('is absent while the window is already open', () => {
      const into = slot()
      render(<GenerateControls {...props({ tuningSlot: into, onOpenPreview: jest.fn() })} />)
      expect(screen.queryByRole('button', { name: /preview window/i })).toBeNull()
    })

    it('opens the window AND gives it something to draw', () => {
      const onOpenPreview = jest.fn()
      const p = props({ onOpenPreview })
      render(<GenerateControls {...p} />)
      ;(p.onPeek as jest.Mock).mockClear()
      fireEvent.click(reopen())
      expect(onOpenPreview).toHaveBeenCalled()
      // Opening alone leaves it shut: the window only renders when it has a subject.
      expect(lastPeek(p.onPeek as jest.Mock)).toMatchObject({ kind: 'stage' })
    })
  })

  /**
   * Building was the only way anything in this panel
   * reached the map, and a build rolls a new world, so changing one setting cost you the map you had.
   */
  describe('applying a change to the map that is already open', () => {
    const apply = () => screen.getByRole('button', { name: /apply to this map/i })

    it('reports the season and the options, and builds nothing', () => {
      const onApply = jest.fn()
      const p = props({ onApply })
      render(<GenerateControls {...p} />)
      fireEvent.change(kinds(), { target: { value: 'forest' } })
      fireEvent.click(apply())
      expect(onApply).toHaveBeenCalledWith('spring', expect.any(Object))
      expect(p.onGenerate).not.toHaveBeenCalled() // the whole point: the map is kept
    })

    it('carries the options the window shows, the same ones a build would use', () => {
      const into = slot()
      const onApply = jest.fn()
      const p = props({ tuningSlot: into, onApply })
      render(<GenerateControls {...p} />)
      fireEvent.change(kinds(), { target: { value: 'forest' } })
      fireEvent.change(within(into).getByLabelText(/^river$/i), { target: { value: 'through' } })
      fireEvent.click(apply())
      expect(onApply).toHaveBeenCalledWith('spring', expect.objectContaining({ river: 'through' }))
    })

    it('is absent when the page cannot apply in place', () => {
      render(<GenerateControls {...props()} />)
      expect(screen.queryByRole('button', { name: /apply to this map/i })).toBeNull()
    })
  })

  it('a build from the panel builds what the window shows', () => {
    const into = slot()
    const p = props({ tuningSlot: into })
    render(<GenerateControls {...p} />)
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    fireEvent.change(within(into).getByLabelText(/^river$/i), { target: { value: 'through' } })
    fireEvent.change(within(into).getByLabelText(/^kind of crossing$/i), { target: { value: 'planks' } })
    fireEvent.click(screen.getByRole('button', { name: /build this world/i }))
    expect(p.onGenerate).toHaveBeenCalledWith('spring', 'forest', expect.any(String), { exits: 'random', pathways: 'random', upTo: 'objects', river: 'through', depth: '1', bridge: 'planks' })
  })

  /**
   * BUILDING TAKES TIME, AND THE PANEL HAS TO SAY SO.
   *
   * Ticket 65 (old 38). `generateStageInEditor` is async and nothing ever showed it running, so on a big map
   * the only feedback was the world changing when it finally landed, and a second impatient click queued an
   * entire second build.
   */
  describe('while it is building', () => {
    /** A build the test finishes by hand, so the in-flight window is a real one and not a race. */
    const deferred = () => {
      let settle: () => void = () => {}
      let fail: (e: Error) => void = () => {}
      const promise = new Promise<void>((res, rej) => { settle = res; fail = rej })
      return { promise, settle, fail }
    }

    const startBuild = () => {
      const d = deferred()
      const p = props({ onGenerate: jest.fn(() => d.promise) })
      render(<GenerateControls {...p} />)
      fireEvent.click(screen.getByRole('button', { name: /build this world/i }))
      return { ...d, p }
    }

    it('says so on the button, and refuses to be clicked again', async () => {
      const { settle, p } = startBuild()
      const busy = await screen.findByRole('button', { name: /building this world/i })
      expect(busy).toBeDisabled()
      expect(busy).toHaveAttribute('aria-busy', 'true')

      fireEvent.click(busy) // the impatient second click
      expect(p.onGenerate).toHaveBeenCalledTimes(1)

      await act(async () => { settle() })
      expect(await screen.findByRole('button', { name: /build this world/i })).toBeEnabled()
    })

    it('gives the button back when the build FAILS, and says so rather than swallowing it', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const { fail } = startBuild()
        await screen.findByRole('button', { name: /building this world/i })
        await act(async () => { fail(new Error('the generator threw')) })
        // The panel is usable again…
        expect(await screen.findByRole('button', { name: /build this world/i })).toBeEnabled()
        // …and the failure was REPORTED. A caught-and-dropped error would leave the user with a button that
        // simply does nothing, which is worse than the stuck one.
        expect(spy).toHaveBeenCalledWith('Building this world failed', expect.any(Error))
        // …to the USER, not only to the console. The console is for me; a message on the panel is the only
        // thing that tells whoever clicked why the map did not change.
        expect(await screen.findByRole('alert')).toHaveTextContent('the generator threw')
      } finally {
        spy.mockRestore()
      }
    })

    it('clears the last failure when the next build starts, so the message always belongs to this click', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const { fail } = startBuild()
        await act(async () => { fail(new Error('the generator threw')) })
        expect(await screen.findByRole('alert')).toHaveTextContent('the generator threw')

        fireEvent.click(await screen.findByRole('button', { name: /build this world/i }))
        expect(screen.queryByRole('alert')).toBeNull()
      } finally {
        spy.mockRestore()
      }
    })
  })
})
