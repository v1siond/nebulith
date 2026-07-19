/**
 * ONE unified right-sidebar card — the user's ask: "one single right sidebar, I want the same we use for
 * tiles, with the extra unit options added … the unit data can be merged in to the general tile card …
 * the animation section from unit would be removed, and it'll work with the button … movement pattern is
 * dead code … triggers should be a button inside the tile/unit card that shows a modal."
 *
 * A selected UNIT renders the SAME PropertiesPanel card a tile uses — with the unit's data folded IN via
 * `unitSection`, NOT a second parallel unit sidebar. We drive the REAL components and assert:
 *   • the unit extras (identity/attacks) live on the SAME card as the tile summary,
 *   • the cell-collision row is HIDDEN for a unit (a unit isn't a cell),
 *   • the animation SECTION is gone — it's a BUTTON now (opens the animation modal),
 *   • Triggers is a BUTTON that opens the triggers modal (with a count badge),
 *   • the movement-pattern section + waypoint plumbing are removed (dead code).
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { render, screen, fireEvent } from '@testing-library/react'
import { PropertiesPanel, type TileControlModel } from '@/components/game/editorChrome'
import * as modals from '@/components/game/modals'
import { UnitSettingsSection, type UnitControlModel } from '@/components/game/modals'
import { type Entity } from '@/game/types'

const TEMPLATES_SRC = resolve(__dirname, '../../pages/personal-projects/game-engine/templates.tsx')

/** A unit's shared tile model — the SAME shape a tile feeds PropertiesPanel, with onOpenAnimator wired
 *  (the "✦ Animate…" button) and NO asset-only writers (so those rows stay out for a unit). */
const unitTile = (over: Partial<TileControlModel> = {}): TileControlModel => ({
  key: 'unit-u1',
  label: 'Goblin',
  dims: { width: 1, height: 1, depth: 1, zoom: 1 },
  color: '#33d6ff',
  colorFallback: '#ffffff',
  onDim: jest.fn(),
  onColor: jest.fn(),
  onClearColor: jest.fn(),
  override: null,
  styleName: 'Emoji',
  onOpenLibrary: jest.fn(),
  pose: {},
  onPose: jest.fn(),
  onPoseReset: jest.fn(),
  onOpenAnimator: jest.fn(),
  ...over,
})

const entity = (over: Partial<Entity> = {}): Entity => ({
  id: 'u1',
  kind: 'enemy',
  col: 1,
  row: 1,
  name: 'Goblin',
  baseStats: { strength: 3, intelligence: 1, defense: 2, maxHp: 20, dodge: 0 },
  ...over,
})

const unitModel = (over: Partial<UnitControlModel> = {}): UnitControlModel => ({
  entity: entity(),
  onPatch: jest.fn(),
  onSize: jest.fn(),
  onOpenAttacks: jest.fn(),
  ...over,
})

function renderUnitCard(props: Partial<React.ComponentProps<typeof PropertiesPanel>> = {}, unit = unitModel()) {
  return render(
    <PropertiesPanel
      collision={null}
      onCollision={jest.fn()}
      tile={unitTile()}
      level={1}
      levelCount={1}
      onLevel={jest.fn()}
      onOpenSettings={jest.fn()}
      onOpenTriggers={jest.fn()}
      triggerCount={0}
      unitSection={<UnitSettingsSection unit={unit} />}
      {...props}
    />,
  )
}

describe('a unit uses the SAME card as a tile (no separate unit sidebar)', () => {
  it('folds the unit extras INTO the one card, alongside the shared tile summary', () => {
    renderUnitCard()
    // the tile summary a tile gets…
    expect(screen.getByRole('button', { name: /Open Tile Library/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Edit settings/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Goblin colour')).toBeInTheDocument()
    // …and the unit-only extras on the SAME card (identity + the enemy's attacks entry).
    expect(screen.getByLabelText('Entity name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Attacks/i })).toBeInTheDocument()
  })

  it('HIDES the cell-collision row for a unit (a unit is not a cell)', () => {
    renderUnitCard()
    expect(screen.queryByRole('button', { name: 'Blocked' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Walkable' })).toBeNull()
    expect(screen.queryByText('— cell —')).toBeNull()
  })

  it('a plain TILE card (no unitSection) still shows the collision row + no unit extras', () => {
    render(
      <PropertiesPanel collision={false} onCollision={jest.fn()} tile={unitTile({ label: 'grass' })} level={1} levelCount={1} onLevel={jest.fn()} onOpenSettings={jest.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Blocked' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Entity name')).toBeNull()
  })
})

describe('the unit ANIMATION section is gone — it is a button now', () => {
  it('shows the "✦ Animate…" button (opens the modal) and NO inline frame editor', () => {
    const onOpenAnimator = jest.fn()
    renderUnitCard({ tile: unitTile({ onOpenAnimator }) })
    // the removed section's inline authoring must NOT be on the card
    expect(screen.queryByText(/See more/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Add animation/i })).toBeNull()
    // the button IS present and fires the modal opener
    const animate = screen.getByRole('button', { name: /Animate/i })
    fireEvent.click(animate)
    expect(onOpenAnimator).toHaveBeenCalledTimes(1)
  })
})

describe('Triggers is a BUTTON that opens the triggers modal', () => {
  it('renders a Triggers button with a count badge and fires onOpenTriggers', () => {
    const onOpenTriggers = jest.fn()
    renderUnitCard({ onOpenTriggers, triggerCount: 2 })
    const btn = screen.getByRole('button', { name: /Triggers/i })
    expect(btn).toHaveTextContent('(2)')
    fireEvent.click(btn)
    expect(onOpenTriggers).toHaveBeenCalledTimes(1)
  })

  it('a CELL card gets the same Triggers button (enter/interact triggers)', () => {
    const onOpenTriggers = jest.fn()
    render(
      <PropertiesPanel collision={false} onCollision={jest.fn()} tile={unitTile({ label: 'grass' })} level={1} levelCount={1} onLevel={jest.fn()} onOpenSettings={jest.fn()} onOpenTriggers={onOpenTriggers} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Triggers/i }))
    expect(onOpenTriggers).toHaveBeenCalledTimes(1)
  })
})

describe('UnitSettingsSection — appearance presets + role-specific entry buttons', () => {
  it('shows figure variants + size presets and wires the enemy attacks button', () => {
    const onSize = jest.fn()
    const onOpenAttacks = jest.fn()
    render(<UnitSettingsSection unit={unitModel({ onSize, onOpenAttacks })} />)
    expect(screen.getByRole('button', { name: 'female' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '2×' }))
    expect(onSize).toHaveBeenCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: /Attacks/i }))
    expect(onOpenAttacks).toHaveBeenCalledTimes(1)
  })

  it('a player gets inventory (not attacks/quests)', () => {
    const onOpenInventory = jest.fn()
    render(<UnitSettingsSection unit={{ entity: entity({ kind: 'player', name: 'Hero' }), onPatch: jest.fn(), onOpenInventory }} />)
    expect(screen.getByRole('button', { name: /Inventory/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Attacks/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Quests/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Inventory/i }))
    expect(onOpenInventory).toHaveBeenCalledTimes(1)
  })
})

describe('movement pattern is removed (dead code)', () => {
  it('modals no longer exports EntityMovementBody', () => {
    expect((modals as Record<string, unknown>).EntityMovementBody).toBeUndefined()
  })

  it('the templates page drops the movement section, waypoint plumbing, and the trigger expando', () => {
    const src = readFileSync(TEMPLATES_SRC, 'utf8')
    expect(src).not.toContain('EntityMovementBody')
    expect(src).not.toContain('title="Movement pattern"')
    expect(src).not.toContain('waypointMode')
    expect(src).not.toContain('appendWaypoint')
    expect(src).not.toContain('title="Trigger"') // the inline expando is gone; triggers open a modal
    // the new wiring IS present
    expect(src).toContain('onOpenTriggers')
    expect(src).toContain('floatingProps')
  })
})
