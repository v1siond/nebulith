import { render, screen, fireEvent } from '@testing-library/react'
import { FloatingPanel, SettingsPanelBody, UnitSettingsSection, UnitStatsBody, type UnitControlModel } from '@/components/game/modals'
import { type TileControlModel } from '@/components/game/editorChrome'
import { type Entity } from '@/game/types'

// ───────────────────────────────────────────────────────────────────────────
// UNIT SETTINGS PANEL — the user's ask: "have the same UX/UI for both, regular
// tiles and units … but on units we'd might have a few extra things here and
// there, like the inventory."
//
// A selected unit opens the SAME FloatingPanel hosting the SAME shared settings
// body (SettingsPanelBody → TileControls) a tile uses, PLUS a unit-only section
// (identity/vitals + inventory). We drive the REAL components and assert:
//   • a unit shows the SAME shared controls a tile does (colour/scale/pose),
//   • asset-only tile controls (Z Width/Z-Index/Display/Shape/Light) stay OUT,
//   • the unit-only section (name, vitals, inventory) shows for a unit,
//   • a plain tile gets NO unit section,
//   • edits fan out to the unit's writers (live-updating, one source of truth).
// ───────────────────────────────────────────────────────────────────────────

/** A unit's shared settings model — mirrors what the page builds from a selected entity:
 *  colour + uniform scale + pose, with the asset-only writers deliberately ABSENT so those rows hide. */
const makeUnitTile = (over: Partial<TileControlModel> = {}): TileControlModel => ({
  key: 'unit-u1',
  label: 'Hero',
  dims: { width: 1, height: 1, depth: 1, zoom: 1 },
  color: '#33d6ff',
  colorFallback: '#ffffff',
  onDim: jest.fn(),
  onColor: jest.fn(),
  onClearColor: jest.fn(),
  styleName: 'Emoji',
  onOpenLibrary: jest.fn(),
  pose: {},
  onPose: jest.fn(),
  onPoseReset: jest.fn(),
  // NO onZWidth / onZIndex / onDisplay / onShape / onLight / onZPos → those rows never render for a unit.
  ...over,
})

/** A tile's model — carries the asset-only writers so those rows DO render (proves the split is real). */
const makeAssetTile = (over: Partial<TileControlModel> = {}): TileControlModel => ({
  ...makeUnitTile({ label: 'wall' }),
  onZWidth: jest.fn(),
  onZIndex: jest.fn(),
  onDisplay: jest.fn(),
  onShape: jest.fn(),
  onLight: jest.fn(),
  ...over,
})

const makeEntity = (over: Partial<Entity> = {}): Entity => ({
  id: 'u1',
  kind: 'player',
  col: 2,
  row: 3,
  name: 'Hero',
  baseStats: { strength: 5, intelligence: 4, defense: 3, maxHp: 30, dodge: 0 },
  ...over,
})

const makeUnit = (over: Partial<UnitControlModel> = {}): UnitControlModel => ({
  entity: makeEntity(),
  onPatch: jest.fn(),
  onOpenInventory: jest.fn(),
  ...over,
})

describe('SettingsPanelBody — a unit uses the SAME settings UX as a tile', () => {
  it('shows the SAME shared controls a tile does (colour, scale, pose)', () => {
    render(<SettingsPanelBody tile={makeUnitTile()} unit={makeUnit()} />)
    // The exact controls a floor-tile settings panel shows — proving parity.
    expect(screen.getByLabelText('Hero colour')).toBeInTheDocument()
    expect(screen.getByLabelText('Width')).toBeInTheDocument()
    expect(screen.getByLabelText('Height')).toBeInTheDocument()
    expect(screen.getByLabelText('Zoom')).toBeInTheDocument()
    expect(screen.getByLabelText('x')).toBeInTheDocument()
    expect(screen.getByLabelText('y')).toBeInTheDocument()
    expect(screen.getByLabelText('rotate')).toBeInTheDocument()
    expect(screen.getByLabelText('flip horizontally')).toBeInTheDocument()
  })

  it('keeps asset-only tile controls OUT of the unit view (clean split)', () => {
    render(<SettingsPanelBody tile={makeUnitTile()} unit={makeUnit()} />)
    expect(screen.queryByLabelText('Z Width')).toBeNull()
    expect(screen.queryByLabelText('Z-Index')).toBeNull()
    expect(screen.queryByLabelText('Light intensity')).toBeNull()
    // Display / Shape toggles (rendered as buttons) are absent too.
    expect(screen.queryByRole('button', { name: 'All faces' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Square' })).toBeNull()
  })

  // The VITALS moved into the "⛊ Stats…" modal (UnitStatsBody) with the unified-card work — only the unit's
  // identity rows + entry buttons stay in the section itself.
  it('renders the unit-only section a tile never gets: identity + inventory (vitals live in the Stats modal)', () => {
    render(<SettingsPanelBody tile={makeUnitTile()} unit={makeUnit()} />)
    expect(screen.getByLabelText('Entity name')).toBeInTheDocument()
    expect(screen.queryByLabelText('player HP')).toBeNull()
    expect(screen.getByRole('button', { name: /Inventory/ })).toBeInTheDocument()
  })

  it('a PLAIN tile (no unit) shows the shared controls but NO unit section', () => {
    render(<SettingsPanelBody tile={makeAssetTile()} />)
    // Shared controls still there…
    expect(screen.getByLabelText('wall colour')).toBeInTheDocument()
    expect(screen.getByLabelText('Width')).toBeInTheDocument()
    // …and the asset-only rows DO show for a tile (proves the split is data-driven, not hardcoded).
    expect(screen.getByLabelText('Z Width')).toBeInTheDocument()
    expect(screen.getByLabelText('Z-Index')).toBeInTheDocument()
    // …but the unit-only extras are absent.
    expect(screen.queryByLabelText('Entity name')).toBeNull()
    expect(screen.queryByRole('button', { name: /Inventory/ })).toBeNull()
  })
})

describe('SettingsPanelBody — edits fan out to the selected unit (one source of truth)', () => {
  it('editing colour writes through the shared colour writer', () => {
    const onColor = jest.fn()
    render(<SettingsPanelBody tile={makeUnitTile({ onColor })} unit={makeUnit()} />)
    fireEvent.change(screen.getByLabelText('Hero colour'), { target: { value: '#ff0000' } })
    expect(onColor).toHaveBeenCalledWith('#ff0000')
  })

  it('editing scale writes through the shared dim writer (→ the unit size)', () => {
    const onDim = jest.fn()
    render(<SettingsPanelBody tile={makeUnitTile({ onDim })} unit={makeUnit()} />)
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '2' } })
    expect(onDim).toHaveBeenCalledWith('zoom', 2)
  })

  it('toggling flip writes through the shared pose writer', () => {
    const onPose = jest.fn()
    render(<SettingsPanelBody tile={makeUnitTile({ onPose })} unit={makeUnit()} />)
    fireEvent.click(screen.getByLabelText('flip horizontally'))
    expect(onPose).toHaveBeenCalledWith({ flip: true })
  })

  it('editing the unit name fans out to the entity patch writer', () => {
    const onPatch = jest.fn()
    render(<SettingsPanelBody tile={makeUnitTile()} unit={makeUnit({ onPatch })} />)
    fireEvent.change(screen.getByLabelText('Entity name'), { target: { value: 'Aria' } })
    expect(onPatch).toHaveBeenCalledWith({ name: 'Aria' })
  })

  it('editing a vital (HP) in the Stats body fans out to the SAME entity patch writer', () => {
    const onPatch = jest.fn()
    render(<UnitStatsBody entity={makeEntity()} onPatch={onPatch} />)
    fireEvent.change(screen.getByLabelText('player HP'), { target: { value: '99' } })
    expect(onPatch).toHaveBeenCalledWith({ baseStats: expect.objectContaining({ maxHp: 99 }) })
  })
})

describe('UnitSettingsSection — the unit-only extras', () => {
  it('opens the inventory for a unit that carries one', () => {
    const onOpenInventory = jest.fn()
    render(<UnitSettingsSection unit={makeUnit({ onOpenInventory })} />)
    fireEvent.click(screen.getByRole('button', { name: /Inventory/ }))
    expect(onOpenInventory).toHaveBeenCalledTimes(1)
  })

  it('shows quests (not inventory) for an NPC', () => {
    const onOpenQuests = jest.fn()
    render(
      <UnitSettingsSection
        unit={{ entity: makeEntity({ kind: 'npc', name: 'Elder' }), onPatch: jest.fn(), onOpenQuests }}
      />,
    )
    expect(screen.queryByRole('button', { name: /Inventory/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Quests/ }))
    expect(onOpenQuests).toHaveBeenCalledTimes(1)
  })
})

describe('the unit settings panel is the SAME floating panel a tile opens', () => {
  it('is a non-blocking FloatingPanel hosting the shared body + unit section', () => {
    render(
      <FloatingPanel title="Hero — Settings" accent="cyan" onClose={() => {}}>
        <SettingsPanelBody tile={makeUnitTile()} unit={makeUnit()} />
      </FloatingPanel>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Hero — Settings' })
    // Same non-modal contract as the tile panel (canvas stays live behind it).
    expect(dialog).not.toHaveAttribute('aria-modal')
    // Shared control + unit extra both live inside the one floating panel.
    expect(screen.getByLabelText('Hero colour')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Inventory/ })).toBeInTheDocument()
  })
})
