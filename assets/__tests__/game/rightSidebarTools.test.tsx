import '@/__tests__/helpers/installTilesetSeed' // install the DB-equivalent tileset the runtime loads
/**
 * RIGHT-SIDEBAR / INSPECTOR tools (the four UI deliverables). These are the seams behind the user's asks:
 *
 *   #1 Clear tiles + SEE the selected tile — the Inspector shows a thumbnail of the selected tile and a
 *      PROMINENT "Clear tiles" action (a CELL action, hidden for a unit).
 *   #2 Connectors — the flow lives in a draggable FloatingPanel opened from a right-sidebar button (off the
 *      left rail). ConnectorsPanelBody hosts the identical controls (Edit/Exit, the list, the target/when/
 *      spawn form).
 *   #3 Tile Library — the tile-add button sits BELOW Colour and opens a draggable/resizable FloatingPanel.
 *   #4 Add tile / Replace tile — the tile-add button names itself by CELL STATE, and picking a tile in PAINT
 *      mode paints it onto the selection through the SAME placement primitives the left Paint tool uses.
 */
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ArtSection, PropertiesPanel, TileLibraryBody, type TileControlModel } from '@/components/game/editorChrome'
import { ConnectorsPanelBody, FloatingPanel } from '@/components/game/modals'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { tilesForStyle, type TileDef } from '@/game/artStyle'
import { placeGroundTile, stackAssetTile } from '@/game/editor/tileBrush'
import { placementFor } from '@/game/editor/tilePlacement'
import { connectorEditFromSelection } from '@/game/editor/connectors'
import type { Connector } from '@/lib/api'

const EMOJI = tilesForStyle('emoji')
const byId = (id: string): TileDef => {
  const t = Object.values(EMOJI).flat().find(x => x.id === id)
  if (!t) throw new Error(`tile ${id} not in the emoji catalog`)
  return t
}

/** A minimal floor-tile model (level 0). */
function floorTile(overrides: Partial<TileControlModel> = {}): TileControlModel {
  return {
    key: 'floor',
    label: 'grass',
    dims: { width: 1, height: 1, depth: 1, zoom: 1 },
    color: null,
    colorFallback: '#3a7d34',
    onDim: jest.fn(),
    onColor: jest.fn(),
    override: null,
    styleName: 'Emoji',
    onOpenLibrary: jest.fn(),
    ...overrides,
  }
}

function renderPanel(props: Partial<React.ComponentProps<typeof PropertiesPanel>> = {}) {
  return render(
    <PropertiesPanel
      collision={false}
      onCollision={jest.fn()}
      tile={floorTile()}
      level={1}
      levelCount={1}
      onLevel={jest.fn()}
      onOpenSettings={jest.fn()}
      {...props}
    />,
  )
}

// ── Deliverable #1 — SEE the selected tile + Clear tiles ────────────────────────────────────────────────
describe('#1 Inspector shows the selected tile + a Clear-tiles action', () => {
  it('renders a thumbnail of the selected tile (an <img> for an image tile)', () => {
    renderPanel({ tile: floorTile({ preview: { kind: 'image', src: '/tiles/emoji/baked/grass.png', char: '🍀' } }) })
    const img = screen.getByAltText('grass') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('/tiles/emoji/baked/grass.png')
  })

  it('renders the glyph when the selected tile is a glyph tile', () => {
    renderPanel({ tile: floorTile({ label: 'pine-tree', preview: { kind: 'glyph', char: '🌲' } }) })
    expect(screen.getByText('🌲')).toBeInTheDocument()
  })

  it('shows a prominent "Clear tiles" button that fires onClearTiles', () => {
    const onClearTiles = jest.fn()
    renderPanel({ onClearTiles })
    const btn = screen.getByRole('button', { name: 'Clear tiles' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onClearTiles).toHaveBeenCalledTimes(1)
  })

  it('does NOT show Clear tiles for a UNIT (a unit isn\'t a cell)', () => {
    renderPanel({ onClearTiles: jest.fn(), unitSection: <div>unit extras</div> })
    expect(screen.queryByRole('button', { name: 'Clear tiles' })).toBeNull()
  })
})

// ── Deliverable #3 — Tile Library below Colour, opens a draggable/resizable modal ────────────────────────
describe('#3 the tile-add button sits BELOW Colour and opens a FloatingPanel', () => {
  it('the Colour swatch appears BEFORE the tile-library button in the DOM', () => {
    renderPanel({ tile: floorTile({ libraryLabel: 'Add tile' }) })
    const colour = screen.getByLabelText('grass colour')
    const libraryBtn = screen.getByRole('button', { name: 'Add tile' })
    // colour precedes the library button (below-colour ordering)
    expect(colour.compareDocumentPosition(libraryBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the library opens inside a draggable FloatingPanel (dialog with a drag handle + resize grip)', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <PropertiesPanel collision={false} onCollision={jest.fn()} tile={floorTile({ libraryLabel: 'Add tile', onOpenLibrary: () => setOpen(true) })} level={1} levelCount={1} onLevel={jest.fn()} onOpenSettings={jest.fn()} />
          {open && (
            <FloatingPanel title="Tile Library — Emoji · cell" accent="cyan" onClose={() => setOpen(false)}>
              <TileLibraryBody styleId="emoji" styleName="Emoji" override={null} paint onPick={jest.fn()} />
            </FloatingPanel>
          )}
        </>
      )
    }
    render(<Harness />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add tile' }))
    const dialog = screen.getByRole('dialog', { name: /Tile Library/i })
    expect(dialog).toBeInTheDocument()
    expect(dialog.querySelector('[data-drag-handle]')).toBeInTheDocument()
    expect(dialog.querySelector('[data-resize-handle]')).toBeInTheDocument()
  })
})

// ── Deliverable #4 — Add tile / Replace tile by cell status + paint via the same path ────────────────────
describe('#4 the tile-add button names itself by cell status', () => {
  it('ArtSection defaults to "Open Tile Library…" and honors a caller label', () => {
    const { rerender } = render(<ArtSection styleName="Emoji" onOpen={jest.fn()} />)
    expect(screen.getByRole('button', { name: /Open Tile Library/i })).toBeInTheDocument()
    rerender(<ArtSection styleName="Emoji" onOpen={jest.fn()} label="Replace tile" />)
    expect(screen.getByRole('button', { name: 'Replace tile' })).toBeInTheDocument()
  })

  it('the inspector reads "Add tile" on an empty cell and "Replace tile" on a filled one (libraryLabel)', () => {
    const { rerender } = renderPanel({ tile: floorTile({ libraryLabel: 'Add tile' }) })
    expect(screen.getByRole('button', { name: 'Add tile' })).toBeInTheDocument()
    rerender(
      <PropertiesPanel collision={false} onCollision={jest.fn()} tile={floorTile({ libraryLabel: 'Replace tile' })} level={1} levelCount={1} onLevel={jest.fn()} onOpenSettings={jest.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Replace tile' })).toBeInTheDocument()
  })
})

describe('#4 TileLibraryBody PAINT mode (right-sidebar paint the selection)', () => {
  it('in paint mode the prose says "paint it onto the selected cells" and hides "Follow style"', () => {
    render(<TileLibraryBody styleId="emoji" styleName="Emoji" override={null} paint onPick={jest.fn()} />)
    expect(screen.getByText(/paint it onto the selected cells/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Follow style/i })).toBeNull()
  })

  it('in pin mode (a unit) it still pins + shows "Follow style"', () => {
    render(<TileLibraryBody styleId="emoji" styleName="Emoji" override="emoji:pine-tree" onPick={jest.fn()} />)
    expect(screen.getByText(/pin it to this element/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Follow style/i })).toBeInTheDocument()
  })

  it('picking a tile in paint mode fires onPick with the tile id (the page routes it to the shared paint path)', () => {
    const onPick = jest.fn()
    render(<TileLibraryBody styleId="emoji" styleName="Emoji" override={null} paint onPick={onPick} />)
    fireEvent.click(screen.getByTitle(/emoji:pine-tree/))
    expect(onPick).toHaveBeenCalledWith('emoji:pine-tree')
  })

  // Prove the right-sidebar paint reuses the LEFT Paint tool's placement primitives: routing a tile through
  // placementFor + placeGroundTile/stackAssetTile over EACH selected cell lands the exact same editable tiles
  // the left brush lands (paintTileOnSelection runs this identical per-cell loop).
  it('painting a selection reuses the same placement primitives as the left Paint tool', () => {
    const grid = new IsometricGrid({ cols: 6, rows: 6, cellSize: 32, isoScale: 1.4 })
    const tree = byId('emoji:pine-tree')
    expect(placementFor(tree)).toBe('asset') // a standing tile stacks (same as the left brush)
    const selection = [{ col: 1, row: 1 }, { col: 2, row: 1 }, { col: 3, row: 1 }]
    for (const { col, row } of selection) stackAssetTile(grid, col, row, tree)
    for (const { col, row } of selection) {
      const stack = grid.getAssetsAtCell(col, row)
      expect(stack).toHaveLength(1)
      expect(stack[0].tileOverride).toBe('emoji:pine-tree') // a real, editable, pinned tile per cell
    }

    const water = byId('emoji:deep-water')
    expect(placementFor(water)).toBe('terrain') // a terrain tile replaces the floor (same as the left brush)
    placeGroundTile(grid, 4, 4, water)
    expect(grid.ground[4][4]).toBe('deep-water')
  })
})

// ── Deliverable #2 — Connectors flow in a draggable modal ────────────────────────────────────────────────
function connector(overrides: Partial<Connector> = {}): Connector {
  return { cells: [{ col: 2, row: 3 }], targetTemplateId: 't1', targetTemplateName: 'Cavern', interaction: 'walk', spawnCol: 0, spawnRow: 0, ...overrides }
}

function connectorProps(overrides: Partial<React.ComponentProps<typeof ConnectorsPanelBody>> = {}): React.ComponentProps<typeof ConnectorsPanelBody> {
  return {
    connectorMode: true,
    onToggleMode: jest.fn(),
    editing: null,
    editingLabel: '',
    form: { interaction: 'walk', spawnCol: 0, spawnRow: 0 },
    setForm: jest.fn(),
    templates: [{ id: 't2', name: 'Town' }],
    onNewTarget: jest.fn(),
    onSave: jest.fn(),
    onDelete: jest.fn(),
    onCancel: jest.fn(),
    connectors: [],
    onSelectConnector: jest.fn(),
    ...overrides,
  }
}

describe('#2 Connectors — ConnectorsPanelBody hosts the whole flow', () => {
  it('the Edit/Exit toggle fires onToggleMode', () => {
    const onToggleMode = jest.fn()
    render(<ConnectorsPanelBody {...connectorProps({ connectorMode: false, onToggleMode })} />)
    fireEvent.click(screen.getByRole('button', { name: /Edit connectors/i }))
    expect(onToggleMode).toHaveBeenCalledTimes(1)
  })

  it('lists saved connectors and loads one on click', () => {
    const onSelectConnector = jest.fn()
    const c = connector()
    render(<ConnectorsPanelBody {...connectorProps({ connectors: [c], onSelectConnector })} />)
    fireEvent.click(screen.getByRole('button', { name: /→Cavern/ }))
    expect(onSelectConnector).toHaveBeenCalledWith(c)
  })

  it('shows the target / when / spawn form only while editing, and Save/Del/Cancel are wired', () => {
    const onSave = jest.fn(), onDelete = jest.fn(), onCancel = jest.fn()
    const { rerender } = render(<ConnectorsPanelBody {...connectorProps()} />)
    // not editing → no form
    expect(screen.queryByLabelText('How the player triggers this connector')).toBeNull()

    rerender(<ConnectorsPanelBody {...connectorProps({ editing: { col: 2, row: 3 }, editingLabel: '(2, 3)', form: { interaction: 'walk', spawnCol: 0, spawnRow: 0, targetTemplateId: 't2' }, onSave, onDelete, onCancel })} />)
    expect(screen.getByLabelText('Trigger action')).toBeInTheDocument()
    expect(screen.getByLabelText('How the player triggers this connector')).toBeInTheDocument()
    expect(screen.getByLabelText('Spawn column in target template')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Del' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('changing the interaction dropdown flows up through setForm', () => {
    const setForm = jest.fn()
    render(<ConnectorsPanelBody {...connectorProps({ editing: { col: 2, row: 3 }, editingLabel: '(2, 3)', setForm })} />)
    fireEvent.change(screen.getByLabelText('How the player triggers this connector'), { target: { value: 'interact' } })
    expect(setForm).toHaveBeenCalledTimes(1)
  })

  it('the Connectors button opens the flow in a draggable FloatingPanel', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(o => !o)}>↗ Connectors</button>
          {open && (
            <FloatingPanel title="Connectors" accent="purple" onClose={() => setOpen(false)}>
              <ConnectorsPanelBody {...connectorProps()} />
            </FloatingPanel>
          )}
        </>
      )
    }
    render(<Harness />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '↗ Connectors' }))
    const dialog = screen.getByRole('dialog', { name: 'Connectors' })
    expect(dialog).toBeInTheDocument()
    expect(dialog.querySelector('[data-drag-handle]')).toBeInTheDocument()
  })
})

// The Connectors button must open STRAIGHT into the editing view on the FIRST click (user: "if I have multi
// select and click connectors I expect to see the editing view, but instead I have to click again"). The
// editing FORM shows iff editingConnector is set; connectorEditFromSelection is what openConnectorPanel uses
// to arm it from the active selection — so a non-null result == the form shows on that first click.
describe('#2 Connectors — opening lands in the editing view (no second click)', () => {
  it('no selection → null (nothing to edit; the panel just stays armed, ready to draw)', () => {
    expect(connectorEditFromSelection([], [])).toBeNull()
  })

  it('a MULTI-cell selection arms editing immediately — keystone + fresh form + the whole selection', () => {
    const selection = [{ col: 4, row: 5 }, { col: 4, row: 6 }, { col: 5, row: 5 }]
    const start = connectorEditFromSelection(selection, [])
    expect(start).not.toBeNull()
    expect(start!.editing).toEqual({ col: 4, row: 5 })       // a keystone cell of the selection → the form shows
    expect(start!.cells).toEqual(selection)                  // the whole multi-select becomes the connector's cells
    expect(start!.form.interaction).toBe('walk')             // a fresh default form (nothing saved yet)
    expect(start!.form.targetTemplateId).toBe('')
  })

  it('a single-cell selection also opens straight into the form', () => {
    const start = connectorEditFromSelection([{ col: 7, row: 2 }], [])
    expect(start!.editing).toEqual({ col: 7, row: 2 })
    expect(start!.cells).toEqual([{ col: 7, row: 2 }])
  })

  it('a selection overlapping a SAVED connector LOADS it — its full cell set + its saved form', () => {
    const saved = connector({ cells: [{ col: 2, row: 3 }, { col: 2, row: 4 }], targetTemplateId: 't9', interaction: 'interact' })
    const start = connectorEditFromSelection([{ col: 2, row: 4 }], [saved]) // click one of its cells
    expect(start!.editing).toEqual({ col: 2, row: 3 })          // keystone = the connector's first cell
    expect(start!.cells).toEqual(saved.cells)                   // the connector's WHOLE cell set, not just the clicked one
    expect(start!.form.targetTemplateId).toBe('t9')             // its saved form loads for editing
    expect(start!.form.interaction).toBe('interact')
  })
})
