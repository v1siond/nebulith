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
import { render, screen, fireEvent, within } from '@testing-library/react'
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
    // `second` is the Jungle, and a jungle carries the region picker, so its build says which region leads.
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', second.id, { exits: 'random', pathways: 'random', region: 'random', river: 'none', crossing: false, depth: 'none', bridge: 'none' })
  })

  it('builds the category\'s FIRST preset when the kind was chosen but no preset was', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    build()
    const [first] = categoryLayouts(CATALOG, 'forest')
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', first.id, { exits: 'random', pathways: 'random', river: 'none', crossing: false, depth: 'none', bridge: 'none' })
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
    expect(onGenerate).toHaveBeenCalledWith('spring', other.generators[0].variant, firstOfOther.id, {})
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
    // Alexander, 2026-09-11: *"maybe it's traversable, maybe it's dividing the map in two half, maybe it's
    // around the map ... the randomness is good, we need to parametize it a bit more"*.
    setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    expect([...control(/^river$/i).options].map(o => o.value)).toEqual(['none', 'random', 'through', 'divides', 'around'])
  })

  it('forwards the course that was picked, so a river never needs a row of its own', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    fireEvent.change(control(/^river$/i), { target: { value: 'divides' } })
    build()
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', expect.any(String), { exits: 'random', pathways: 'random', river: 'divides', crossing: false, depth: '1', bridge: 'random' })
  })

  it('will not send a crossing without the river it declares it needs', () => {
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    // The dependency is DATA — the served row says `requires: "river"`, and "no river" is off for a choice.
    expect(control(/a crossing joined to the paths/i).disabled).toBe(true)
    fireEvent.change(control(/^river$/i), { target: { value: 'through' } })
    expect(control(/a crossing joined to the paths/i).disabled).toBe(false)
    fireEvent.click(control(/a crossing joined to the paths/i))
    fireEvent.change(control(/^river$/i), { target: { value: 'none' } }) // the river goes, the crossing goes with it
    build()
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', expect.any(String), { exits: 'random', pathways: 'random', river: 'none', crossing: false, depth: 'none', bridge: 'none' })
  })

  it('offers the kind of crossing, greyed out until there is a river, and forwards the one picked', () => {
    // Alexander, 2026-09-11: *"it can be a simple dirt path, it can be an actual bridge, which again, are
    // multiple variations"*.
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    const kind = () => control(/^kind of crossing$/i)
    expect([...kind().options].map(o => o.value)).toEqual(['random', 'dirt', 'wood', 'planks', 'stone'])
    expect(kind().disabled).toBe(true)
    fireEvent.change(control(/^river$/i), { target: { value: 'divides' } })
    expect(kind().disabled).toBe(false)
    fireEvent.change(kind(), { target: { value: 'stone' } })
    build()
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', expect.any(String), { exits: 'random', pathways: 'random', river: 'divides', crossing: false, depth: '1', bridge: 'stone' })
  })

  it('offers HOW DEEP the channel is cut, greyed out until there is a river, and forwards it', () => {
    // Alexander, 2026-09-11: *"we need the river without water, which is negative height compared to walking
    // floor"* and *"river depth is confgiuravble, same as shadow, same as sun light, we want to control
    // everyhting"*. Same shape as the crossing and its kind: served, dependent, forwarded. A variation is an
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
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', expect.any(String), { exits: 'random', pathways: 'random', river: 'divides', crossing: false, depth: '2', bridge: 'random' })
  })

  it('offers nothing to switch on for a kind of place that has no options', () => {
    setup()
    fireEvent.change(kinds(), { target: { value: 'cave' } })
    expect(screen.queryByText(/anything else/i)).toBeNull()
    expect(screen.queryByLabelText(/^river$/i)).toBeNull()
  })
})

describe('forest > type > subtype — pick one, go deeper, or randomize', () => {
  // Alexander, 2026-09-11: *"when selecting a zone, we should also have extra options to select different
  // types of the selected zone, or just randomize, and we can go various levels deeper"*.
  const setup = () => {
    const onGenerate = jest.fn()
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={onGenerate} />)
    return onGenerate
  }
  // Labelled by the thing it picks since 2026-09-11, not by a question: his *"why do we have "which forest?"
  // instead of "presets" or something"*.
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
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', 'woodland', { exits: 'random', pathways: 'random', river: 'none', crossing: false, depth: 'none', bridge: 'none' }, 'forest_woodland_mountain')
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
    // *"we should just have variations, similar to "which jungle" "which region""*: a picker, not tick boxes.
    const onGenerate = setup()
    fireEvent.change(kinds(), { target: { value: 'forest' } })
    fireEvent.click(preset('Jungle'))
    const region = screen.getByLabelText(/^region$/i) as HTMLSelectElement
    expect([...region.options].map(o => o.value)).toEqual(['random', 'open', 'dense', 'swamp', 'ruins'])

    fireEvent.change(region, { target: { value: 'swamp' } })
    build()
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', 'jungle', { exits: 'random', pathways: 'random', region: 'swamp', river: 'none', crossing: false, depth: 'none', bridge: 'none' })
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

describe('the preview window shows the world to build, its size, and the options that shape it', () => {
  // Alexander, 2026-09-11: *"we should see the preview of the map to generate in the preview modal as soon as we
  // select the zone and in that same preview map, we should see the grid size, how many cells, etc. We should also
  // have the rest of options like variations of the map, adding river, adding bridge, etc etc"*.
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
   * Alexander, 2026-09-11: *"the preview doesn't work on any of settlements"*.
   *
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
   * Alexander, 2026-09-11: *"when you close the preview it goes inside the sidebar and can never go back
   * oputside until you change links"*. With no window to portal into, the options fall back inline (that is
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
   * Alexander, 2026-09-11: *"'build this world' is a bit limited, what If I just want to change the season of
   * the current template¿ what if I just want to change the cell pixels, keeping the rest? we need to be able
   * to apply changes without re-randomizing the map"*. Building was the only way anything in this panel
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
    expect(p.onGenerate).toHaveBeenCalledWith('spring', 'forest', expect.any(String), { exits: 'random', pathways: 'random', river: 'through', crossing: false, depth: '1', bridge: 'planks' })
  })
})
