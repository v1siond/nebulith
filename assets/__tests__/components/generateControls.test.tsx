/**
 * THE ⚡ GENERATE PANEL (§4.6).
 *
 * The menu IS the backend catalog (T-113 / §3.14b Tier-1 #1). It used to render from four hand-kept
 * frontend tables — `STAGE_ZONES`, `STAGE_VARIANTS`, `STAGE_VARIANT_LABELS`, `VARIANT_LAYOUTS` — that
 * duplicated `Nebulith.Catalog.GeneratorSource`. These tests drive the REAL component against a verbatim
 * capture of `/api/generators`, so they prove two things at once: every season / map type / shape the menu
 * offers comes from the catalog, and the menu offers NOTHING the catalog does not carry.
 *
 * They also pin §4.6's two behavioural changes and its numbered steps:
 *
 *   1. clicking a map type **selects** it rather than generating — *"today it generates immediately … a
 *      genuine 'why did my map just vanish' trap"*;
 *   2. the steps are NUMBERED (`1 · SEASON` … `4 · MAP SIZE`), which is what tells a first-time user the
 *      order without being told;
 *   3. MAP SIZE defines the grid's MATRIX — columns × rows of cell-size cells.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { GenerateControls } from '@/components/game/editorChrome'
import { GENERATOR_LAYERS } from '@/components/game/editorConfig'
import { EMPTY_GENERATOR_CATALOG, catalogZones, categoryLayouts, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)
const noop = () => {}

const generateWorld = () => fireEvent.click(screen.getByRole('button', { name: /generate world/i }))

describe('the menu IS the catalog', () => {
  it('renders a season chip for every season the catalog serves, and no others', () => {
    render(<GenerateControls catalog={CATALOG} zone="summer" onZone={noop} onGenerate={noop} />)
    for (const zone of catalogZones(CATALOG)) {
      expect(screen.getByRole('button', { name: zone })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'beach' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'lava' })).not.toBeInTheDocument()
  })

  it('renders a map-type card for every category, labelled with the backend\'s own name', () => {
    render(<GenerateControls catalog={CATALOG} zone="summer" onZone={noop} onGenerate={noop} />)
    for (const category of CATALOG) {
      expect(screen.getByRole('button', { name: category.name })).toBeInTheDocument()
    }
  })

  it('marks the active season pressed, and reports a season click without generating', () => {
    const onZone = jest.fn()
    const onGenerate = jest.fn()
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={onZone} onGenerate={onGenerate} />)
    expect(screen.getByRole('button', { name: 'spring' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'winter' }))
    expect(onZone).toHaveBeenCalledWith('winter')
    expect(onGenerate).not.toHaveBeenCalled()
  })
})

describe('§4.6 numbers the steps — that IS the instruction', () => {
  it('labels them 1 · SEASON, 2 · WHAT KIND OF PLACE?, 4 · MAP SIZE', () => {
    render(
      <GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop}
        size={{ cols: 40, rows: 34, cellSize: 16 }} onResize={noop} />,
    )
    expect(screen.getByText(/1 · season/i)).toBeInTheDocument()
    expect(screen.getByText(/2 · what kind of place\?/i)).toBeInTheDocument()
    expect(screen.getByText(/4 · map size/i)).toBeInTheDocument()
  })

  it('numbers the SHAPE step with the map type it belongs to', () => {
    render(<GenerateControls catalog={CATALOG} zone="summer" onZone={noop} onGenerate={noop} />)
    fireEvent.click(screen.getByRole('button', { name: 'Forest' }))
    expect(screen.getByText(/3 · shape \(forest\)/i)).toBeInTheDocument()
  })
})

describe('picking a map type SELECTS — it does not destroy the open map', () => {
  it('does not generate when a map type is clicked', () => {
    const onGenerate = jest.fn()
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={onGenerate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Town' }))
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('marks the clicked type as the selection', () => {
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop} />)
    fireEvent.click(screen.getByRole('button', { name: 'Town' }))
    expect(screen.getByRole('button', { name: 'Town' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('touches the open map on NO click but the generate one — the trap §4.6 names', () => {
    const onGenerate = jest.fn()
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={onGenerate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Town' }))
    fireEvent.click(screen.getByRole('button', { name: 'Forest' }))
    fireEvent.click(screen.getByRole('button', { name: 'winter' }))
    expect(onGenerate).not.toHaveBeenCalled()
  })
})

describe('generating is an explicit act, and forwards the catalog\'s own ids', () => {
  it('forwards the picked shape id verbatim — the seam templates.tsx turns into generateStage({layout})', () => {
    for (const { id, label } of categoryLayouts(CATALOG, 'forest')) {
      const onGenerate = jest.fn()
      const { unmount } = render(<GenerateControls catalog={CATALOG} zone="summer" onZone={noop} onGenerate={onGenerate} />)
      fireEvent.click(screen.getByRole('button', { name: label }))
      generateWorld()
      expect(onGenerate).toHaveBeenCalledWith('summer', 'forest', id)
      unmount()
    }
  })

  it('generates the category\'s FIRST shape when the type was selected but no shape was', () => {
    const onGenerate = jest.fn()
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={onGenerate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Forest' }))
    generateWorld()
    expect(onGenerate).toHaveBeenCalledWith('spring', 'forest', categoryLayouts(CATALOG, 'forest')[0].id)
  })

  it('passes NO shape for a map type that has none, and hides the shape group', () => {
    const onGenerate = jest.fn()
    render(<GenerateControls catalog={CATALOG} zone="summer" onZone={noop} onGenerate={onGenerate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Town' }))
    generateWorld()
    expect(onGenerate).toHaveBeenCalledWith('summer', 'town', undefined)
    expect(screen.queryByRole('button', { name: 'Meadow' })).not.toBeInTheDocument()
  })

  it('does NOT carry a shape across map types', () => {
    const onGenerate = jest.fn()
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={onGenerate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Meadow + River' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cave' }))
    generateWorld()
    expect(onGenerate).toHaveBeenLastCalledWith('spring', 'cave', undefined)
  })
})

/**
 * `4 · MAP SIZE` — the grid's MATRIX VARIABLES.
 *
 * Alexander, 2026-09-08: *"the map should have a cell size and how many rows x columns there's in the map,
 * where columns = the number of cells per row … basically the grid is just a matrix, we must define the
 * matrix variables"*. So three inputs, not two. `cellSize` is what a cell MEASURES in pixels — not the
 * camera's zoom — which is why applying it rebuilds the grid.
 */
describe('the map matrix — columns × rows of cell-size cells', () => {
  const SIZE = { cols: 40, rows: 34, cellSize: 16 }
  const withSize = (over: Partial<typeof SIZE> = {}) => {
    const onResize = jest.fn()
    render(
      <GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop}
        size={{ ...SIZE, ...over }} onResize={onResize} />,
    )
    return onResize
  }

  it('is absent when no resize handler is wired — there is no map to rebuild', () => {
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop} />)
    expect(screen.queryByLabelText(/map columns/i)).not.toBeInTheDocument()
  })

  it('exposes all THREE matrix variables', () => {
    withSize()
    expect(screen.getByLabelText(/map columns/i)).toHaveValue(40)
    expect(screen.getByLabelText(/map rows/i)).toHaveValue(34)
    expect(screen.getByLabelText(/map cell size/i)).toHaveValue(16)
  })

  it('says what COLUMNS means — cells per row — and totals the matrix', () => {
    withSize()
    expect(screen.getByText(/40 columns × 34 rows = 1,360 cells/i)).toBeInTheDocument()
    expect(screen.getByText(/columns is how many cells fit in one row/i)).toBeInTheDocument()
  })

  it('warns that rebuilding clears the map BEFORE the user commits', () => {
    withSize()
    expect(screen.getByText(/clears the map/i)).toBeInTheDocument()
  })

  it('does NOT rebuild while typing — the numbers are a draft', () => {
    const onResize = withSize()
    fireEvent.change(screen.getByLabelText(/map columns/i), { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText(/map cell size/i), { target: { value: '32' } })
    expect(onResize).not.toHaveBeenCalled()
  })

  it('applies all three together', () => {
    const onResize = withSize()
    fireEvent.change(screen.getByLabelText(/map columns/i), { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText(/map rows/i), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText(/map cell size/i), { target: { value: '32' } })
    fireEvent.click(screen.getByRole('button', { name: /Rebuild as 60 × 50 @ 32px/i }))
    expect(onResize).toHaveBeenCalledWith(60, 50, 32)
  })

  it('refuses a cell size the world cannot run in, and says those bounds', () => {
    const onResize = withSize()
    fireEvent.change(screen.getByLabelText(/map cell size/i), { target: { value: '0' } })
    expect(screen.getByText(/a cell is 4.*128 pixels square/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Rebuild as/i }))
    expect(onResize).not.toHaveBeenCalled()
  })

  it('refuses a grid the engine cannot build, and says those bounds instead', () => {
    const onResize = withSize()
    fireEvent.change(screen.getByLabelText(/map columns/i), { target: { value: '0' } })
    expect(screen.getByText(/a map is 10.*100 cells on each side/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Rebuild as/i }))
    expect(onResize).not.toHaveBeenCalled()
  })

  it('refuses a no-op rebuild — it would clear the map for nothing', () => {
    const onResize = withSize()
    fireEvent.click(screen.getByRole('button', { name: /Rebuild as/i }))
    expect(onResize).not.toHaveBeenCalled()
  })

  it('follows the map when it is rebuilt from ELSEWHERE — generating, or loading a level', () => {
    const props = { catalog: CATALOG, zone: 'spring', onZone: noop, onGenerate: noop, onResize: noop }
    const { rerender } = render(<GenerateControls {...props} size={SIZE} />)
    rerender(<GenerateControls {...props} size={{ cols: 12, rows: 12, cellSize: 64 }} />)
    expect(screen.getByLabelText(/map columns/i)).toHaveValue(12)
    expect(screen.getByLabelText(/map cell size/i)).toHaveValue(64)
  })
})

describe('an unavailable catalog is SAID, never faked', () => {
  it('offers no map types and no generate button while the catalog is empty', () => {
    render(<GenerateControls catalog={EMPTY_GENERATOR_CATALOG} zone="spring" onZone={noop} onGenerate={noop} />)
    for (const name of ['Forest', 'Town', 'City', 'Cave', 'Temple']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /generate world/i })).not.toBeInTheDocument()
  })

  it('says the generators are loading when nothing has failed yet', () => {
    render(<GenerateControls catalog={EMPTY_GENERATOR_CATALOG} zone="spring" onZone={noop} onGenerate={noop} />)
    expect(screen.getByText(/Loading the map generators/i)).toBeInTheDocument()
  })

  it('names the failure when the load failed, instead of an empty menu', () => {
    render(
      <GenerateControls catalog={EMPTY_GENERATOR_CATALOG} catalogError="Service Unavailable"
        zone="spring" onZone={noop} onGenerate={noop} />,
    )
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument()
    expect(screen.getByText(/Service Unavailable/)).toBeInTheDocument()
  })
})

// The layers are engine PASSES (stageGenerator's LAYER_IDS), not generator records — `/api/generators`
// serves no layer list, so this row stays frontend data. It must be the SAME set for every map type.
describe('the per-part re-roll rows', () => {
  it('shows every generator layer, and the SAME set for every map type', () => {
    render(<GenerateControls catalog={CATALOG} zone="summer" onZone={noop} onGenerate={noop} onRandomizeLayer={noop} />)
    for (const category of CATALOG) {
      fireEvent.click(screen.getByRole('button', { name: category.name }))
      GENERATOR_LAYERS.forEach(({ label }) => {
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
      })
    }
  })

  it('forwards the clicked layer id (data-driven, no per-id branch)', () => {
    GENERATOR_LAYERS.forEach(({ id, label }) => {
      const onRandomizeLayer = jest.fn()
      const { unmount } = render(
        <GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop} onRandomizeLayer={onRandomizeLayer} />,
      )
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(onRandomizeLayer).toHaveBeenCalledWith(id)
      unmount()
    })
  })

  it('§4.6 also draws RE-ROLL THE SELECTION — it names the count and says what to do first', () => {
    const onRandomizeSelection = jest.fn()
    const { rerender } = render(
      <GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop}
        selectedCount={0} onRandomizeSelection={onRandomizeSelection} />,
    )
    expect(screen.getByRole('button', { name: /randomize the selection/i })).toBeDisabled()
    expect(screen.getByText(/select some cells on the map first/i)).toBeInTheDocument()

    rerender(
      <GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop}
        selectedCount={4} onRandomizeSelection={onRandomizeSelection} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /randomize 4 selected tiles/i }))
    expect(onRandomizeSelection).toHaveBeenCalled()
  })

  it('hides the layer row entirely when no handler is wired (no current map to scope)', () => {
    render(<GenerateControls catalog={CATALOG} zone="spring" onZone={noop} onGenerate={noop} />)
    expect(screen.queryByRole('button', { name: 'Decor' })).not.toBeInTheDocument()
  })
})
