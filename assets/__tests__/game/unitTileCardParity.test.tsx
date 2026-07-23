/**
 * ONE tile UI — a UNIT is configured on the EXACT SAME card as any other tile.
 *
 * Alexander: "we should just have one tile UI … should be the same FOR ALL TILES, including units, all
 * tiles behave the same"; "we must remove the player small card"; "the colour, etc are just the regular
 * tile settings"; "the part that says 'figure, male female, etc' that would be removed — units are just
 * tiles, so if we want to replace a tile we should use the regular replace tile button and see a list of
 * characters to pick"; "stats would be a button that shows a draggable, movable, resizable modal where we
 * control all those extra unit settings"; "inventory and abilities must be moved to the tile menu".
 *
 * What this locks (EDITOR-INTERACTION-SPEC §8 · §10 · §13):
 *   1. PARITY — every control a selected TILE gets, a selected UNIT gets too (same components, one card).
 *   2. The FIGURE variant row is GONE; art swaps through the SAME "Replace tile" button, whose library
 *      lists the character tiles.
 *   3. Collision is ONE control — the card's Blocked/Walkable toggle IS the unit's "blocks movement";
 *      the old standalone checkbox is gone.
 *   4. "Stats…" opens a draggable/resizable FloatingPanel carrying HP/DEF/STR/INT/DODGE% + Hittable.
 *   5. Name + Size stay as ROWS on the card; Inventory & abilities is reachable from the card.
 *   6. "Remove tile" deletes the unit (no bespoke Delete/Deselect pair).
 *   7. SOURCE GUARD — the page no longer renders the unit SelectionHeader ("▸ PLAYER (PLAYER) @ 32,10")
 *      nor the Delete/Deselect buttons, and wires the new seams.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PropertiesPanel, type TileControlModel } from '@/components/game/editorChrome'
import { FloatingPanel, UnitSettingsSection, UnitStatsBody, type UnitControlModel } from '@/components/game/modals'
import { type Entity } from '@/game/types'

const TEMPLATES_SRC = resolve(__dirname, '../../pages/personal-projects/game-engine/templates.tsx')

const entity = (over: Partial<Entity> = {}): Entity => ({
  id: 'u1',
  kind: 'enemy',
  col: 4,
  row: 7,
  name: 'Goblin',
  baseStats: { strength: 3, intelligence: 1, defense: 2, maxHp: 20, dodge: 5 },
  ...over,
})

const unitModel = (over: Partial<UnitControlModel> = {}): UnitControlModel => ({
  entity: entity(),
  onPatch: jest.fn(),
  onSize: jest.fn(),
  onOpenStats: jest.fn(),
  ...over,
})

/** The shared tile model. A unit feeds the IDENTICAL shape a tile does — that is the whole point. */
const tileModel = (over: Partial<TileControlModel> = {}): TileControlModel => ({
  key: 'tile',
  label: 'thing',
  dims: { width: 1, height: 1, depth: 1, zoom: 1 },
  color: null,
  colorFallback: '#ffffff',
  onDim: jest.fn(),
  onColor: jest.fn(),
  onClearColor: jest.fn(),
  override: null,
  styleName: 'Emoji',
  libraryLabel: 'Replace tile',
  onOpenLibrary: jest.fn(),
  pose: {},
  onPose: jest.fn(),
  onPoseReset: jest.fn(),
  onOpenAnimator: jest.fn(),
  ...over,
})

/** Every control a card exposes, by its accessible name — the comparable "control set". */
const controlNames = (container: HTMLElement) =>
  within(container)
    .getAllByRole('button')
    .map(b => (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/\s+/g, ' ').trim())

function renderCard(props: Partial<React.ComponentProps<typeof PropertiesPanel>> = {}) {
  return render(
    <PropertiesPanel
      collision={false}
      onCollision={jest.fn()}
      tile={tileModel()}
      level={1}
      levelCount={1}
      onLevel={jest.fn()}
      onOpenSettings={jest.fn()}
      onOpenTriggers={jest.fn()}
      onClearTiles={jest.fn()}
      onRemove={jest.fn()}
      {...props}
    />,
  )
}

// ── 1. PARITY — the unit card IS the tile card ──────────────────────────────────────────────────────
describe('a selected UNIT renders the SAME control set as a selected tile', () => {
  it('every control on the tile card is present on the unit card', () => {
    const cell = renderCard()
    const cellControls = controlNames(cell.container)
    cell.unmount()

    const unit = renderCard({ unitSection: <UnitSettingsSection unit={unitModel()} /> })
    const unitControls = controlNames(unit.container)

    expect(cellControls.length).toBeGreaterThan(0)
    for (const name of cellControls) expect(unitControls).toContain(name)
  })

  it('the unit card carries the tile summary: colour swatch, tile chip, Replace tile, Edit settings, Animate', () => {
    renderCard({
      tile: tileModel({ label: 'Goblin', preview: { kind: 'image', src: '/tiles/emoji/goblin.png', char: '👺' } }),
      unitSection: <UnitSettingsSection unit={unitModel()} />,
    })
    expect(screen.getByAltText('Goblin')).toBeInTheDocument() // the tile chip shows the unit's baked art
    expect(screen.getByLabelText('Goblin colour')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace tile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Animate tile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit triggers' })).toBeInTheDocument()
  })

  it('shows the Clear tiles action for a unit too (the tile card vocabulary: add / replace / clear / remove)', () => {
    const onClearTiles = jest.fn()
    renderCard({ onClearTiles, unitSection: <UnitSettingsSection unit={unitModel()} /> })
    fireEvent.click(screen.getByRole('button', { name: 'Clear tiles' }))
    expect(onClearTiles).toHaveBeenCalledTimes(1)
  })
})

// ── 2. The FIGURE row is gone — art swaps via the SAME Replace tile button ──────────────────────────
describe('the Figure (neutral/male/female/…) row is REMOVED', () => {
  it('renders no figure-variant buttons anywhere on the unit card', () => {
    renderCard({ unitSection: <UnitSettingsSection unit={unitModel()} /> })
    for (const v of ['neutral', 'male', 'female', 'old', 'child', 'alien', 'robot']) {
      expect(screen.queryByRole('button', { name: v })).toBeNull()
    }
    expect(screen.queryByText('Figure')).toBeNull()
  })

  it('the unit swaps its art through the standard Replace tile button (→ the tile library)', () => {
    const onOpenLibrary = jest.fn()
    renderCard({ tile: tileModel({ onOpenLibrary }), unitSection: <UnitSettingsSection unit={unitModel()} /> })
    fireEvent.click(screen.getByRole('button', { name: 'Replace tile' }))
    expect(onOpenLibrary).toHaveBeenCalledTimes(1)
  })
})

// ── 3. ONE collision control ────────────────────────────────────────────────────────────────────────
describe('"Blocks movement" is served by the ONE Collision toggle', () => {
  it('the unit card shows the Blocked / Walkable toggle', () => {
    renderCard({ unitSection: <UnitSettingsSection unit={unitModel()} /> })
    expect(screen.getByRole('button', { name: 'Blocked' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Walkable' })).toBeInTheDocument()
  })

  it('clicking Blocked fires the shared collision writer', () => {
    const onCollision = jest.fn()
    renderCard({ onCollision, unitSection: <UnitSettingsSection unit={unitModel()} /> })
    fireEvent.click(screen.getByRole('button', { name: 'Blocked' }))
    expect(onCollision).toHaveBeenCalledWith(true)
  })

  it('there is NO separate "Blocks movement" checkbox — on the card or in the Stats body', () => {
    const { unmount } = renderCard({ unitSection: <UnitSettingsSection unit={unitModel()} /> })
    expect(screen.queryByLabelText('Blocks movement')).toBeNull()
    unmount()
    render(<UnitStatsBody entity={entity()} onPatch={jest.fn()} />)
    expect(screen.queryByLabelText('Blocks movement')).toBeNull()
  })
})

// ── 4. Stats… → a draggable/resizable FloatingPanel ─────────────────────────────────────────────────
describe('Stats… opens a draggable, movable, resizable modal with the extra unit settings', () => {
  it('the card carries a Stats… button wired to the opener', () => {
    const onOpenStats = jest.fn()
    renderCard({ unitSection: <UnitSettingsSection unit={unitModel({ onOpenStats })} /> })
    fireEvent.click(screen.getByRole('button', { name: /Stats/i }))
    expect(onOpenStats).toHaveBeenCalledTimes(1)
  })

  it('the stats live in a FloatingPanel (drag handle + resize grip) — HP/DEF/STR/INT/DODGE% + Hittable', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <PropertiesPanel
            collision={false}
            onCollision={jest.fn()}
            tile={tileModel()}
            level={1}
            levelCount={1}
            onLevel={jest.fn()}
            onOpenSettings={jest.fn()}
            unitSection={<UnitSettingsSection unit={unitModel({ onOpenStats: () => setOpen(true) })} />}
          />
          {open && (
            <FloatingPanel title="Goblin — Stats" accent="orange" onClose={() => setOpen(false)}>
              <UnitStatsBody entity={entity()} onPatch={jest.fn()} />
            </FloatingPanel>
          )}
        </>
      )
    }
    render(<Harness />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Stats/i }))
    const dialog = screen.getByRole('dialog', { name: /Stats/i })
    expect(dialog.querySelector('[data-drag-handle]')).toBeInTheDocument()
    expect(dialog.querySelector('[data-resize-handle]')).toBeInTheDocument()
    for (const label of ['enemy HP', 'enemy DEF', 'enemy STR', 'enemy INT', 'enemy DODGE%']) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument()
    }
    expect(within(dialog).getByLabelText('Hittable')).toBeInTheDocument()
  })

  it('editing a stat and toggling Hittable fan out through the entity patch writer', () => {
    const onPatch = jest.fn()
    render(<UnitStatsBody entity={entity()} onPatch={onPatch} />)
    fireEvent.change(screen.getByLabelText('enemy HP'), { target: { value: '99' } })
    expect(onPatch).toHaveBeenCalledWith({ baseStats: expect.objectContaining({ maxHp: 99 }) })
    fireEvent.click(screen.getByLabelText('Hittable'))
    expect(onPatch).toHaveBeenCalledWith({ hittable: false }) // an enemy defaults hittable → the click clears it
  })

  it('keeps the enemy-only extras (kill-quest tag + respawn) reachable in the Stats modal', () => {
    render(<UnitStatsBody entity={entity()} onPatch={jest.fn()} />)
    expect(screen.getByLabelText('Enemy type')).toBeInTheDocument()
    expect(screen.getByLabelText('Respawn seconds')).toBeInTheDocument()
  })

  it('does NOT duplicate the stats on the card — they live only in the modal', () => {
    renderCard({ unitSection: <UnitSettingsSection unit={unitModel()} /> })
    expect(screen.queryByLabelText('enemy HP')).toBeNull()
    expect(screen.queryByLabelText('Hittable')).toBeNull()
  })
})

// ── 5. Name + Size stay as card rows; Inventory & abilities reachable from the card ─────────────────
describe('Name + Size stay as rows on the tile card', () => {
  it('the Name row writes through the entity patch writer', () => {
    const onPatch = jest.fn()
    renderCard({ unitSection: <UnitSettingsSection unit={unitModel({ onPatch })} /> })
    fireEvent.change(screen.getByLabelText('Entity name'), { target: { value: 'Aria' } })
    expect(onPatch).toHaveBeenCalledWith({ name: 'Aria' })
  })

  it('the Size 1×/2×/3× row writes through the size writer', () => {
    const onSize = jest.fn()
    renderCard({ unitSection: <UnitSettingsSection unit={unitModel({ onSize })} /> })
    fireEvent.click(screen.getByRole('button', { name: '3×' }))
    expect(onSize).toHaveBeenCalledWith(3)
  })
})

describe('Inventory & abilities is reachable from the tile card', () => {
  it('a player card opens the inventory (the same modal/data as today)', () => {
    const onOpenInventory = jest.fn()
    renderCard({
      unitSection: (
        <UnitSettingsSection
          unit={unitModel({ entity: entity({ kind: 'player', name: 'Hero' }), onOpenInventory, onOpenStats: jest.fn() })}
        />
      ),
    })
    fireEvent.click(screen.getByRole('button', { name: /Inventory & abilities/i }))
    expect(onOpenInventory).toHaveBeenCalledTimes(1)
  })

  it('an NPC keeps quests and an enemy keeps attacks — nothing lost', () => {
    const onOpenQuests = jest.fn()
    const { unmount } = render(
      <UnitSettingsSection unit={unitModel({ entity: entity({ kind: 'npc' }), onOpenQuests })} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Quests/i }))
    expect(onOpenQuests).toHaveBeenCalledTimes(1)
    unmount()

    const onOpenAttacks = jest.fn()
    render(<UnitSettingsSection unit={unitModel({ onOpenAttacks })} />)
    fireEvent.click(screen.getByRole('button', { name: /Attacks/i }))
    expect(onOpenAttacks).toHaveBeenCalledTimes(1)
  })
})

// ── 6. Remove tile deletes the unit ─────────────────────────────────────────────────────────────────
describe('Remove tile deletes the unit (no bespoke Delete / Deselect pair)', () => {
  it('fires onRemove from the shared "Remove tile" button', () => {
    const onRemove = jest.fn()
    renderCard({ onRemove, unitSection: <UnitSettingsSection unit={unitModel()} /> })
    fireEvent.click(screen.getByRole('button', { name: /Remove tile/i }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('the card offers no Delete / Deselect buttons of its own', () => {
    renderCard({ unitSection: <UnitSettingsSection unit={unitModel()} /> })
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Deselect' })).toBeNull()
  })
})

// ── 7. SOURCE GUARD — the page drops the player header card + Delete/Deselect and wires the new seams ─
describe('the page replaces the unit menu with the tile card', () => {
  const src = readFileSync(TEMPLATES_SRC, 'utf8')

  it('drops the unit SelectionHeader ("▸ PLAYER (PLAYER) @ 32,10") and the Delete / Deselect buttons', () => {
    expect(src).not.toContain('SelectionHeader kind={selEntity.kind}')
    expect(src).not.toContain('>Deselect<')
    expect(src).not.toContain('onClick={deleteSelectedEntity}')
    // nothing is LOST with the header: the coords ride the card title, like the cell card's `Cell (3, 4)`
    expect(src).toContain('(${selEntity.col}, ${selEntity.row})')
  })

  it('gives the unit card the SAME Save map button the cell card has (one component)', () => {
    expect(src.match(/<SaveMapButton /g) ?? []).toHaveLength(2)
  })

  it('routes the unit through the shared card seams: collision → blocksMovement, Remove tile → delete', () => {
    expect(src).toContain('blocksMovement')
    expect(src).toContain('onRemove={deleteSelectedEntity}')
    expect(src).toContain("libraryLabel: 'Replace tile'")
  })

  it('opens the Stats body in a geometry-persisting FloatingPanel (id "stats")', () => {
    expect(src).toContain('UnitStatsBody')
    expect(src).toContain("floatingProps('stats'")
  })
})
