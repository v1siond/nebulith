import { render, screen, fireEvent } from '@testing-library/react'
import { CharacterWindow, UnitSettingsSection, UnitStatsBody, type UnitControlModel } from '@/components/modals'
import { TileControls } from '@/components/editorChrome'
import { type TileControlModel } from '@/components/editorChrome'
import { type Entity } from '@/game/types'
import '@/__tests__/helpers/installTilesetSeed'

// ───────────────────────────────────────────────────────────────────────────
// UNIT SETTINGS PANEL, the user's ask: "have the same UX/UI for both, regular
// tiles and units … but on units we'd might have a few extra things here and
// there, like the inventory."
//
// A selected unit opens the SAME FloatingPanel hosting the SAME shared settings
// body (TileControls) a tile uses, PLUS a unit-only section
// (identity/vitals + inventory). We drive the REAL components and assert:
//   • a unit shows the SAME shared controls a tile does (colour/scale/pose),
//   • asset-only tile controls (Z Width/Z-Index/Display/Shape/Light) stay OUT,
//   • the unit-only section (name, vitals, inventory) shows for a unit,
//   • a plain tile gets NO unit section,
//   • edits fan out to the unit's writers (live-updating, one source of truth).
// ───────────────────────────────────────────────────────────────────────────

/** A unit's shared settings model, mirrors what the page builds from a selected entity:
 *  colour + uniform scale + pose, with the asset-only writers deliberately ABSENT so those rows hide. */
const makeUnitTile = (over: Partial<TileControlModel> = {}): TileControlModel => ({
  key: 'unit-u1',
  label: 'Hero',
  dims: { width: 1, height: 1, depth: 1 },
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

/** A tile's model, carries the asset-only writers so those rows DO render (proves the split is real). */
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

describe('the shared control body, a unit uses the SAME settings UX as a tile', () => {
  it('shows the SAME shared controls a tile does (colour, scale, pose)', () => {
    render(<><TileControls tile={makeUnitTile()} /><UnitSettingsSection unit={makeUnit()} /></>)
    // The exact controls a floor-tile settings panel shows, proving parity.
    expect(screen.getByLabelText('Hero colour')).toBeInTheDocument()
    expect(screen.getByLabelText('Width')).toBeInTheDocument()
    expect(screen.getByLabelText('Height')).toBeInTheDocument()
    expect(screen.getByLabelText('Depth')).toBeInTheDocument()
    // The nudge controls say what they DO now, bare x / y / rotate / "flip horizontally" became
    // Left ↔ Right, Up ↕ Down, Rotate and Mirror. The labels changed; the writers did not.
    expect(screen.getByLabelText('Left ↔ Right')).toBeInTheDocument()
    expect(screen.getByLabelText('Up ↕ Down')).toBeInTheDocument()
    expect(screen.getByLabelText('Rotate')).toBeInTheDocument()
    expect(screen.getByLabelText('Mirror')).toBeInTheDocument()
  })

  it('keeps asset-only tile controls OUT of the unit view (clean split)', () => {
    render(<><TileControls tile={makeUnitTile()} /><UnitSettingsSection unit={makeUnit()} /></>)
    expect(screen.queryByRole('group', { name: 'Footprint per direction' })).toBeNull() // was "Z Width"
    expect(screen.queryByLabelText('Draw order')).toBeNull() // was "Z-Index"
    expect(screen.queryByLabelText('Light intensity')).toBeNull()
    // Display / Shape toggles (rendered as buttons) are absent too.
    expect(screen.queryByRole('button', { name: 'All faces' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Square' })).toBeNull()
  })

  // The NAME, the SIZE and the STATS all live in the Character window now. What is left in this
  // section is the pathways OUT to the big editors (inventory, quests, attacks), which are real windows of their
  // own rather than a button behind a button.
  it('renders the unit-only section a tile never gets: the pathways out to the big editors', () => {
    render(<><TileControls tile={makeUnitTile()} /><UnitSettingsSection unit={makeUnit()} /></>)
    expect(screen.getByRole('button', { name: /Inventory/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Entity name')).toBeNull() // it is in the Character window
    expect(screen.queryByRole('button', { name: /Stats/ })).toBeNull() // ditto, no separate window
  })

  it('the CHARACTER WINDOW carries the name, the size, the stats AND the figure picker, in one place', () => {
    // The whole of the complaint in one assertion:
    render(
      <CharacterWindow
        entity={makeEntity()}
        styleId="emoji"
        fromLabel="player"
        onPatch={jest.fn()}
        onSize={jest.fn()}
        onSwap={jest.fn()}
      />,
    )
    expect(screen.getByLabelText('Entity name')).toBeInTheDocument()
    expect(screen.getByLabelText('player HP')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2×' })).toBeInTheDocument()
    // the figure picker itself, not a button that opens the figure picker
    expect(screen.getByPlaceholderText(/search .* characters/i)).toBeInTheDocument()
  })

  it('a PLAIN tile (no unit) shows the shared controls but NO unit section', () => {
    render(<TileControls tile={makeAssetTile()} />)
    // Shared controls still there…
    expect(screen.getByLabelText('wall colour')).toBeInTheDocument()
    expect(screen.getByLabelText('Width')).toBeInTheDocument()
    // …and the asset-only rows DO show for a tile (proves the split is data-driven, not hardcoded).
    // The footprint is a MULTI-DIRECTION control, named for what it means: how many cells the tile covers. "Z
    // Width"/"Z-Index" said nothing.
    expect(screen.getByRole('group', { name: 'Footprint per direction' })).toBeInTheDocument()
    expect(screen.getByLabelText('Draw order')).toBeInTheDocument()
    // …but the unit-only extras are absent.
    expect(screen.queryByRole('button', { name: /Inventory/ })).toBeNull()
  })
})

describe('the shared control body, edits fan out to the selected unit (one source of truth)', () => {
  it('editing colour writes through the shared colour writer', () => {
    const onColor = jest.fn()
    render(<><TileControls tile={makeUnitTile({ onColor })} /><UnitSettingsSection unit={makeUnit()} /></>)
    fireEvent.change(screen.getByLabelText('Hero colour'), { target: { value: '#ff0000' } })
    expect(onColor).toHaveBeenCalledWith('#ff0000')
  })

  it('editing scale writes through the shared dim writer (→ the unit size)', () => {
    const onDim = jest.fn()
    render(<><TileControls tile={makeUnitTile({ onDim })} /><UnitSettingsSection unit={makeUnit()} /></>)
    fireEvent.change(screen.getByLabelText('Depth'), { target: { value: '2' } })
    expect(onDim).toHaveBeenCalledWith('depth', 2)
  })

  it('toggling flip writes through the shared pose writer', () => {
    const onPose = jest.fn()
    render(<><TileControls tile={makeUnitTile({ onPose })} /><UnitSettingsSection unit={makeUnit()} /></>)
    fireEvent.click(screen.getByLabelText('Mirror'))
    expect(onPose).toHaveBeenCalledWith({ flip: true })
  })

  it('editing the unit name fans out to the entity patch writer', () => {
    const onPatch = jest.fn()
    render(<CharacterWindow entity={makeEntity()} styleId="emoji" fromLabel="player" onPatch={onPatch} onSwap={jest.fn()} />)
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

describe('UnitSettingsSection, the unit-only extras', () => {
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

