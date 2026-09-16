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
 * WHAT CHANGED AGAIN. A TYPE is an ENVIRONMENT and a CATEGORY is the kind of terrain, so the forest category
 * is `wilderness` and it carries nine cards. The catalog is FLAT: what used to be a subtype under a card is a
 * card of its own. A card travels by its row KEY and the engine BUILDER travels beside it as the layout,
 * because nine environments share three builders and a builder cannot say which one was clicked.
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
import { shouldOpenPreviewOnPeek } from '@/components/game/previewOpening'
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

/** What a wilderness row sends when nothing has been switched: its served defaults, dependencies honoured. */
const WILD_DEFAULTS = { exits: 'random', pathways: 'random', region: 'random', river: 'none', depth: 'none', bridge: 'none' }

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
    const wild = [...kinds().querySelectorAll('option')].find(o => o.textContent?.startsWith('Wilderness'))
    expect(wild?.textContent).toMatch(new RegExp(`\\(${categoryLayouts(CATALOG, 'wilderness').length}\\)`))
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
    fireEvent.change(kinds(), { target: { value: 'wilderness' } })
    expect(onGenerate).not.toHaveBeenCalled()
    const [{ label }] = categoryLayouts(CATALOG, 'wilderness')
    fireEvent.click(preset(label))
    expect(onGenerate).not.toHaveBeenCalled()
    build()
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('marks the clicked preset as the selection', () => {
    setup()
    fireEvent.change(kinds(), { target: { value: 'wilderness' } })
    const [, second] = categoryLayouts(CATALOG, 'wilderness')
    fireEvent.click(preset(second.label))
    expect(preset(second.label)).toHaveAttribute('aria-pressed', 'true')
  })

  it('forwards the picked preset id verbatim — the seam templates.tsx turns into generateStage({layout})', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'wilderness' } })
    const [, second] = categoryLayouts(CATALOG, 'wilderness')
    fireEvent.click(preset(second.label))
    build()
    // THE ROW TRAVELS BY KEY and its BUILDER travels as the layout. `second` is the Jungle, and the swamp,
    // the beach, the ruins and the desert all run that same jungle builder, so the key is the only thing that
    // says which of the five was clicked.
    expect(second.id).toBe('forest_jungle')
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', 'jungle', WILD_DEFAULTS, 'forest_jungle')
  })

  it('builds the category\'s FIRST preset when the kind was chosen but no preset was', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'wilderness' } })
    build()
    const [first] = categoryLayouts(CATALOG, 'wilderness')
    expect(first.id).toBe('forest_woodland')
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', 'woodland', WILD_DEFAULTS, 'forest_woodland')
  })

  it('does NOT carry a preset across kinds of place', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'wilderness' } })
    const [, second] = categoryLayouts(CATALOG, 'wilderness')
    fireEvent.click(preset(second.label))
    const other = CATALOG.find(c => c.key !== 'wilderness' && categoryLayouts(CATALOG, c.key).length > 0)
    if (!other) return
    fireEvent.change(kinds(), { target: { value: other.key } })
    build()
    const [firstOfOther] = categoryLayouts(CATALOG, other.key)
    // The options sent are that kind of place's OWN defaults, not the ones the previous pick carried. A town
    // serves pathways now, so it sends its own `random` pathways rather than the empty map this used to expect: what
    // matters is that nothing came ACROSS from the kind of place clicked before.
    const [, , , options, key] = onGenerate.mock.calls[onGenerate.mock.calls.length - 1]
    expect(key).toBe(firstOfOther.id)
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
    fireEvent.change(kinds(), { target: { value: 'wilderness' } })
    expect([...control(/^river$/i).options].map(o => o.value)).toEqual(['none', 'random', 'through', 'divides', 'around'])
  })

  it('forwards the course that was picked, so a river never needs a row of its own', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'wilderness' } })
    fireEvent.change(control(/^river$/i), { target: { value: 'divides' } })
    build()
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', expect.any(String), { ...WILD_DEFAULTS, river: 'divides', depth: '1', bridge: 'random' }, expect.any(String))
  })


  // THE `crossing` TOGGLE IS GONE ("'A crossing joined to the paths' what does even mean???? I don't know
  // why we have it in the UI"), and the test that pinned it went with it. The rule it covered, that an option
  // declaring `requires: "river"` is off without one, is the subject of the two below.
  it('offers the kind of crossing, greyed out until there is a river, and forwards the one picked', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'wilderness' } })
    const kind = () => control(/^kind of crossing$/i)
    expect([...kind().options].map(o => o.value)).toEqual(['random', 'dirt', 'wood', 'planks', 'stone'])
    expect(kind().disabled).toBe(true)
    fireEvent.change(control(/^river$/i), { target: { value: 'divides' } })
    expect(kind().disabled).toBe(false)
    fireEvent.change(kind(), { target: { value: 'stone' } })
    build()
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', expect.any(String), { ...WILD_DEFAULTS, river: 'divides', depth: '1', bridge: 'stone' }, expect.any(String))
  })

  it('offers HOW DEEP the channel is cut, greyed out until there is a river, and forwards it', () => {
    // and Same shape as the crossing and its kind: served, dependent, forwarded. A variation is an
    // option, so it gets the same coverage the other options have.
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'wilderness' } })
    const depth = () => control(/how deep the channel is cut/i)

    expect([...depth().options].map(o => o.value)).toEqual(['1', '2']) // not-cut is the off value, not a choice
    expect(depth().disabled).toBe(true) // nothing to cut without a river
    fireEvent.change(control(/^river$/i), { target: { value: 'divides' } })
    expect(depth().disabled).toBe(false)
    fireEvent.change(depth(), { target: { value: '2' } })
    build()
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', expect.any(String), { ...WILD_DEFAULTS, river: 'divides', depth: '2', bridge: 'random' }, expect.any(String))
  })

  it('offers nothing to switch on for a kind of place that has no options', () => {
    setup()
    fireEvent.change(kinds(), { target: { value: 'cave' } })
    expect(screen.queryByText(/anything else/i)).toBeNull()
    expect(screen.queryByLabelText(/^river$/i)).toBeNull()
  })
})

describe('a card is a TYPE, and a type carries the regions it is made of', () => {
  /**
   * THE SUBTYPE PICKER IS GONE, and so are the four cases that drove it. The catalog was forest > type >
   * subtype, and a woodland's standard version, its subtypes and Random were a second `<select>` under the
   * card. Every one of those subtypes is a TYPE now with a card of its own, the catalog carries no children
   * at all, and the panel renders that select only for a row that has some. There is nothing left to pick, so
   * there is nothing left to assert: what survives is the REGION, which is the picker a type really does
   * carry.
   */
  const setup = () => {
    const onGenerate = jest.fn()
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={onGenerate} />)
    return onGenerate
  }

  /** The `region` choices the row itself declares, so this file never keeps its own list of them. */
  const servedRegions = (key: string) =>
    (CATALOG.flatMap(c => c.generators).find(g => g.key === key)?.options ?? [])
      .find(o => o.key === 'region')?.choices.map(c => c.key) ?? []

  it('a jungle offers the REGIONS its row declares, and forwards the one picked', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'wilderness' } })
    fireEvent.click(preset('Jungle'))
    const region = screen.getByLabelText(/^region$/i) as HTMLSelectElement
    const served = servedRegions('forest_jungle')
    expect(served.length).toBeGreaterThan(1) // the row really does declare some
    expect([...region.options].map(o => o.value)).toEqual(served)

    fireEvent.change(region, { target: { value: 'lakeside' } })
    build()
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', 'jungle', { ...WILD_DEFAULTS, region: 'lakeside' }, 'forest_jungle')
  })

  it('a CITY offers its own neighbourhoods, not the wood\'s regions', () => {
    // The region picker is the row's, not one list the panel keeps: a city is divided by class, a wood by
    // canopy, and neither knows the other's keys.
    setup()
    fireEvent.change(kinds(), { target: { value: 'city' } })
    const region = screen.getByLabelText(/^region$/i) as HTMLSelectElement
    expect([...region.options].map(o => o.value)).toEqual(servedRegions('city'))
    expect([...region.options].map(o => o.value)).not.toEqual(servedRegions('forest_jungle'))
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

/**
 * THE RE-ROLL-THE-SELECTION SECTION IS GONE FROM THIS PANEL.
 *
 * The action itself is untouched: the cell card and the unit card in the right sidebar each carry their own
 * randomize button, and R still fires it. What it lost is the third copy, in a panel about building a NEW
 * world, where a selection on the map that is open has nothing to do with the subject.
 */
describe('re-rolling a selection is not this panel\'s business', () => {
  it('draws no randomize section, inline or in the preview window', () => {
    const into = document.body.appendChild(document.createElement('div'))
    try {
      const { container } = render(
        <GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop} tuningSlot={into} />,
      )
      expect(within(container).queryByText(/^randomize$/i)).toBeNull()
      expect(within(into).queryByText(/^randomize$/i)).toBeNull()
      expect(screen.queryByRole('button', { name: /randomize .*(selected|selection)/i })).toBeNull()
      expect(screen.queryByText(/select some cells on the map first/i)).toBeNull()
    } finally {
      into.remove()
    }
  })
})

/**
 * THE ORDER THE PANEL READS IN.
 *
 * Two things had to stop costing a scroll: the build actions sat under every card and every option, and the
 * size sat under the variations when it is the first thing anyone sets.
 *
 * Both are DOM ORDER, which is what this suite can hold: the actions come first so they can pin to the top of
 * the panel, and the size is asked for before the cards that get picked for it. The pinning itself is the
 * `.pstick` rule in the editor stylesheet, so the class is asserted rather than the offset.
 */
describe('the panel reads in the order things are set', () => {
  const SIZE_PROPS = { sizeDraft: SIZE, size: SIZE, onSizeDraft: noop, onResize: noop }
  /** True when `first` really is earlier in the document than `second`. */
  const comesBefore = (first: Element, second: Element) =>
    (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

  it('puts the build actions above everything they act on, in the block that pins to the top', () => {
    const { container } = render(
      <GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop} onApply={noop} {...SIZE_PROPS} />,
    )
    const build = screen.getByRole('button', { name: /build this world/i })
    const apply = screen.getByRole('button', { name: /apply to this map/i })
    expect(comesBefore(build, apply)).toBe(true)
    expect(comesBefore(apply, kinds())).toBe(true)
    expect(comesBefore(apply, screen.getByLabelText(/^map columns$/i))).toBe(true)
    expect(build.closest('.pstick')).not.toBeNull()
    expect(apply.closest('.pstick')).toBe(build.closest('.pstick'))
    expect(container.querySelectorAll('.pstick')).toHaveLength(1)
  })

  it('asks for the size before the preset cards, because the size is the first thing set', () => {
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop} {...SIZE_PROPS} />)
    fireEvent.change(kinds(), { target: { value: 'wilderness' } })
    const [{ label }] = categoryLayouts(CATALOG, 'wilderness')
    for (const field of ['Map columns', 'Map rows', 'Cell size in pixels']) {
      expect(comesBefore(screen.getByLabelText(field), preset(label))).toBe(true)
    }
  })

  it('promises what the build will produce next to the numbers that decide it', () => {
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop} {...SIZE_PROPS} />)
    const promise = screen.getByText(
      `At ${SIZE.cols} × ${SIZE.rows} cells of ${SIZE.cellSize}px: the numbers you typed, exactly.`,
    )
    expect(comesBefore(screen.getByLabelText('Cell size in pixels'), promise)).toBe(true)
  })

  it('says the generator decides when the panel is given no size at all', () => {
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop} />)
    expect(screen.getByText('The generator picks the size.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^map columns$/i)).toBeNull()
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
    // The ROW's archetype, which is `forest` for a wilderness row and never the category's own key.
    expect(lastPeek(p.onPeek as jest.Mock)).toMatchObject({ kind: 'stage', zone: 'spring', variant: 'forest', cols: 60, rows: 40 })
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

  it('with a preview window, the options live in it while the size and the build button stay in the panel', () => {
    const into = slot()
    const p = props({ tuningSlot: into })
    const { container } = render(<GenerateControls {...p} />)
    fireEvent.change(kinds(), { target: { value: 'wilderness' } })
    expect(within(into).getByLabelText(/^river$/i)).toBeInTheDocument()
    expect(within(into).getByLabelText(/^kind of crossing$/i)).toBeInTheDocument()
    expect(within(into).getByLabelText(/^season$/i)).toBeInTheDocument() // the season shapes the world, so it travels too
    expect(into.textContent).toContain('60 × 40 = 2,400 cells, 16px each')
    expect(within(container).queryByLabelText(/^river$/i)).toBeNull()
    expect(within(container).getByRole('button', { name: /build this world/i })).toBeInTheDocument()
    expect(within(into).queryByRole('button', { name: /build this world/i })).toBeNull()
    // The SIZE is set before the world is picked, so its inputs stay in the panel rather than travelling
    // into the window with the options.
    expect(within(container).getByLabelText(/^map columns$/i)).toBeInTheDocument()
    expect(within(into).queryByLabelText(/^map columns$/i)).toBeNull()
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
    fireEvent.change(kinds(), { target: { value: 'village' } })
    const peek = lastPeek(p.onPeek as jest.Mock)
    expect(peek.variant).toBe('town') // a village RUNS the town archetype
    expect(peek.variant).not.toBe('village') // which is not an archetype the engine builds
    // …and it is the ROW that was peeked, named by the backend, not the category standing in for it.
    expect(peek).toMatchObject({ kind: 'stage', name: 'Woodland village' })
  })

  /**
   * THE WAY BACK IS THE CARD, and there is no button.
   *
   * A reopen button at the foot of the sidebar is the far end of the scroll from the card you just clicked,
   * so clicking a preset is what shows the window: the peek it emits says `pick`, and `shouldOpenPreviewOnPeek`
   * (the page's half of this) opens the window for a pick and for nothing else. Clicking the SAME preset again
   * is still a pick, which is what makes closing and reopening work with no button to press.
   */
  describe('the way back to the preview window', () => {
    const reasonOf = (onPeek: jest.Mock) => onPeek.mock.calls[onPeek.mock.calls.length - 1][1]

    it('offers no reopen button, in either place the options can live', () => {
      const { rerender } = render(<GenerateControls {...props({ hasPreviewWindow: true })} />)
      expect(screen.queryByRole('button', { name: /preview window/i })).toBeNull()
      rerender(<GenerateControls {...props({ hasPreviewWindow: true, tuningSlot: slot() })} />)
      expect(screen.queryByRole('button', { name: /preview window/i })).toBeNull()
    })

    it('reports a PICK when a preset is clicked, which is what reopens the window', () => {
      const p = props({ hasPreviewWindow: true })
      render(<GenerateControls {...p} />)
      fireEvent.change(kinds(), { target: { value: 'wilderness' } })
      const [{ label }] = categoryLayouts(CATALOG, 'wilderness')
      fireEvent.click(preset(label))
      expect(reasonOf(p.onPeek as jest.Mock)).toBe('pick')
      expect(shouldOpenPreviewOnPeek(reasonOf(p.onPeek as jest.Mock))).toBe(true)
    })

    it('reports a pick again on the SECOND click of the same preset, so it can be shown again', () => {
      const p = props({ hasPreviewWindow: true })
      render(<GenerateControls {...p} />)
      fireEvent.change(kinds(), { target: { value: 'wilderness' } })
      const [{ label }] = categoryLayouts(CATALOG, 'wilderness')
      fireEvent.click(preset(label))
      ;(p.onPeek as jest.Mock).mockClear()
      fireEvent.click(preset(label))
      expect(reasonOf(p.onPeek as jest.Mock)).toBe('pick')
    })

    it('never reports a pick for a hover, or for the resting peek it draws itself with', () => {
      const p = props({ hasPreviewWindow: true, tuningSlot: slot() })
      render(<GenerateControls {...p} />)
      // The peek the panel emits on mount is the resting one: a window closed by hand must stay closed.
      expect(reasonOf(p.onPeek as jest.Mock)).toBe('resting')
      // Choosing the kind of place is a pick of its own, so the cursor's own peeks are counted from here.
      fireEvent.change(kinds(), { target: { value: 'wilderness' } })
      ;(p.onPeek as jest.Mock).mockClear()
      const [{ label }] = categoryLayouts(CATALOG, 'wilderness')
      fireEvent.pointerEnter(preset(label))
      expect(reasonOf(p.onPeek as jest.Mock)).toBe('hover')
      fireEvent.pointerLeave(preset(label))
      expect(reasonOf(p.onPeek as jest.Mock)).toBe('hover')
      expect((p.onPeek as jest.Mock).mock.calls.every(([, reason]) => !shouldOpenPreviewOnPeek(reason))).toBe(true)
    })

    /**
     * A hover peek is a WORLD: the big preview is built at the map's size, so running the cursor across the
     * cards with the window shut rebuilt one per card for a picture nobody could see. With no window on
     * screen a hover says nothing; the click still does.
     */
    it('says nothing on hover while the window is shut, and still reports the click', () => {
      const p = props({ hasPreviewWindow: true })
      render(<GenerateControls {...p} />)
      fireEvent.change(kinds(), { target: { value: 'wilderness' } })
      const [{ label }] = categoryLayouts(CATALOG, 'wilderness')
      ;(p.onPeek as jest.Mock).mockClear()
      fireEvent.pointerEnter(preset(label))
      fireEvent.pointerLeave(preset(label))
      expect(p.onPeek).not.toHaveBeenCalled()
      fireEvent.click(preset(label))
      expect(reasonOf(p.onPeek as jest.Mock)).toBe('pick')
    })

    it('keeps the options out of the sidebar while the page has a window, and inline when it has none', () => {
      const { container, rerender } = render(<GenerateControls {...props({ hasPreviewWindow: true })} />)
      expect(within(container).queryByLabelText(/^season$/i)).toBeNull()
      rerender(<GenerateControls {...props({ hasPreviewWindow: false })} />)
      expect(within(container).getByLabelText(/^season$/i)).toBeInTheDocument()
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
      fireEvent.change(kinds(), { target: { value: 'wilderness' } })
      fireEvent.click(apply())
      expect(onApply).toHaveBeenCalledWith('spring', expect.any(Object))
      expect(p.onGenerate).not.toHaveBeenCalled() // the whole point: the map is kept
    })

    it('carries the options the window shows, the same ones a build would use', () => {
      const into = slot()
      const onApply = jest.fn()
      const p = props({ tuningSlot: into, onApply })
      render(<GenerateControls {...p} />)
      fireEvent.change(kinds(), { target: { value: 'wilderness' } })
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
    fireEvent.change(kinds(), { target: { value: 'wilderness' } })
    fireEvent.change(within(into).getByLabelText(/^river$/i), { target: { value: 'through' } })
    fireEvent.change(within(into).getByLabelText(/^kind of crossing$/i), { target: { value: 'planks' } })
    fireEvent.click(screen.getByRole('button', { name: /build this world/i }))
    expect(p.onGenerate).toHaveBeenCalledWith('spring', 'forest', expect.any(String), { ...WILD_DEFAULTS, river: 'through', depth: '1', bridge: 'planks' }, expect.any(String))
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
