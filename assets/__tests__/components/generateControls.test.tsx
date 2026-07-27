import { render, screen, fireEvent } from '@testing-library/react'
import { GenerateControls } from '@/components/game/editorChrome'
import { FOREST_LAYOUT_OPTIONS, GENERATOR_LAYERS, STAGE_VARIANTS, VARIANT_LAYOUTS } from '@/components/game/editorConfig'

// The seam this proves: the forest-layout the user picks in GenerateControls is FORWARDED verbatim to
// `onGenerate(zone, variant, layout)` — the handler that (in templates.tsx) calls
// `generateStage({ layout })`. A mocked onGenerate stands in for that handler so we assert on the seam.
describe('GenerateControls — forest layout selection forwards to onGenerate', () => {
  const noop = () => {}

  it('shows the forest-layout picker by default (forest is the active variant) with every option', () => {
    render(<GenerateControls zone="summer" onZone={noop} onGenerate={noop} />)
    FOREST_LAYOUT_OPTIONS.forEach(({ label }) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    })
  })

  it('forwards the picked layout id to onGenerate for the forest variant (data-driven, no per-id branch)', () => {
    // Every option, including ids whose generator lands in a later deliverable (meadow / meadow_river),
    // must thread through unchanged — proving the wiring is data-driven, not a hardcoded switch.
    FOREST_LAYOUT_OPTIONS.forEach(({ id, label }) => {
      const onGenerate = jest.fn()
      const { unmount } = render(<GenerateControls zone="summer" onZone={noop} onGenerate={onGenerate} />)
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(onGenerate).toHaveBeenCalledWith('summer', 'forest', id)
      unmount()
    })
  })

  it('generates the forest variant with the DEFAULT layout when the plain variant button is clicked', () => {
    const onGenerate = jest.fn()
    render(<GenerateControls zone="spring" onZone={noop} onGenerate={onGenerate} />)
    fireEvent.click(screen.getByRole('button', { name: 'forest' }))
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', FOREST_LAYOUT_OPTIONS[0].id)
  })

  it('passes undefined layout for non-forest variants and hides the layout picker', () => {
    const onGenerate = jest.fn()
    render(<GenerateControls zone="summer" onZone={noop} onGenerate={onGenerate} />)
    fireEvent.click(screen.getByRole('button', { name: 'town' }))
    expect(onGenerate).toHaveBeenCalledWith('summer', 'town', undefined)
    // The forest-layout row is scoped to the forest variant, so it disappears once town is active.
    expect(screen.queryByRole('button', { name: 'Meadow' })).not.toBeInTheDocument()
  })

  it('remembers the last-picked layout when the generic forest button is clicked again', () => {
    const onGenerate = jest.fn()
    render(<GenerateControls zone="autumn" onZone={noop} onGenerate={onGenerate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Meadow + River' })) // pick 'meadow_river'
    fireEvent.click(screen.getByRole('button', { name: 'forest' }))          // re-generate forest
    expect(onGenerate).toHaveBeenLastCalledWith('autumn', 'forest', 'meadow_river')
  })
})

// The layouts are DATA (VARIANT_LAYOUTS), not a `variant === 'forest'` branch: the menu shows a layout group
// for exactly the map types that have one, and none for the rest — so adding a town/temple layout is data-only.
describe('GenerateControls — layouts are per-map-type DATA (no per-variant branch)', () => {
  const noop = () => {}

  it('shows a layout group ONLY for map types that carry layouts in VARIANT_LAYOUTS', () => {
    render(<GenerateControls zone="summer" onZone={noop} onGenerate={noop} />)
    for (const v of STAGE_VARIANTS) {
      fireEvent.click(screen.getByRole('button', { name: v }))
      const hasLayouts = (VARIANT_LAYOUTS[v]?.length ?? 0) > 0
      for (const opt of VARIANT_LAYOUTS[v] ?? []) {
        expect(screen.getByRole('button', { name: opt.label })).toBeInTheDocument()
      }
      // a layout-less map type surfaces none of forest's layout buttons
      if (!hasLayouts) expect(screen.queryByRole('button', { name: 'Meadow' })).not.toBeInTheDocument()
    }
  })
})

// The core fix: the per-layer re-roll is a GLOBAL sub-category set — the SAME five for every map type, never a
// town-only concept. It must render identically whether forest, town, cave… is the selected variant.
describe('GenerateControls — the per-layer re-roll row is UNIVERSAL across map types', () => {
  const noop = () => {}

  it('shows every generator layer, and the SAME set for every map type (not gated per variant)', () => {
    render(<GenerateControls zone="summer" onZone={noop} onGenerate={noop} onRandomizeLayer={noop} />)
    for (const v of STAGE_VARIANTS) {
      fireEvent.click(screen.getByRole('button', { name: v }))
      GENERATOR_LAYERS.forEach(({ label }) => {
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
      })
    }
  })

  it('forwards the clicked layer id to onRandomizeLayer (data-driven, no per-id branch)', () => {
    GENERATOR_LAYERS.forEach(({ id, label }) => {
      const onRandomizeLayer = jest.fn()
      const { unmount } = render(<GenerateControls zone="spring" onZone={noop} onGenerate={noop} onRandomizeLayer={onRandomizeLayer} />)
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(onRandomizeLayer).toHaveBeenCalledWith(id)
      unmount()
    })
  })

  it('hides the layer row entirely when no onRandomizeLayer is wired (no current map to scope)', () => {
    render(<GenerateControls zone="spring" onZone={noop} onGenerate={noop} />)
    expect(screen.queryByRole('button', { name: 'Decor' })).not.toBeInTheDocument()
  })
})
