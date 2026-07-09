/**
 * CELL inspector STRUCTURE — the reworked PropertiesPanel must render EXACTLY TWO sections:
 *   1. CELL  — just the Collision toggle (a cell is a fixed slot).
 *   2. TILE  — the ONE selected tile as a SINGLE consolidated group: which-tile + Open Tile Library,
 *              Colour, Width/Height/Depth/Zoom, and x/y/rotate/flip — with a ▲▼ level stepper.
 *
 * These tests assert the SECTION LAYOUT (the ordered divider list), not just that a control exists — the
 * exact failure past passes missed: four overlapping sections (CELL + FLOOR + WALL + POSE) instead of two.
 */
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PropertiesPanel, type TileControlModel } from '@/components/game/editorChrome'

/** A minimal floor-tile model (level 0), with a pose so x/y/rotate/flip render. */
function floorTile(overrides: Partial<TileControlModel> = {}): TileControlModel {
  return {
    key: 'floor',
    label: 'grass',
    dims: { width: 1, height: 1, depth: 1, zoom: 1 },
    color: null,
    colorFallback: '#3a7d34',
    onDim: jest.fn(),
    onColor: jest.fn(),
    onClearColor: jest.fn(),
    override: null,
    styleName: 'Emoji',
    onOpenLibrary: jest.fn(),
    pose: { dx: 0, dy: 0, rot: 0 },
    onPose: jest.fn(),
    onPoseReset: jest.fn(),
    ...overrides,
  }
}

/** The ordered list of section-divider texts the inspector renders (the `— … —` headings). */
function dividerList(): string[] {
  return screen
    .getAllByText((_content, el) => {
      const t = el?.textContent?.trim() ?? ''
      return el?.tagName === 'P' && /^—\s.+\s—$/.test(t)
    })
    // getAllByText matches ancestors too; keep only the leaf <p> headings
    .filter(el => el.tagName === 'P')
    .map(el => el.textContent!.trim())
}

describe('Cell inspector — exactly two sections', () => {
  it('a bare grass cell renders EXACTLY [CELL, TILE·grass] — not a separate FLOOR + POSE', () => {
    render(<PropertiesPanel collision={false} onCollision={jest.fn()} tile={floorTile()} level={1} levelCount={1} onLevel={jest.fn()} />)

    // The whole divider list is 2, in order — this is the structural proof.
    expect(dividerList()).toEqual(['— cell —', '— tile · grass —'])

    // No leftover per-tile / separate-pose sections.
    expect(screen.queryByText(/^— floor/i)).toBeNull()
    expect(screen.queryByText(/^— wall/i)).toBeNull()
    expect(screen.queryByText(/^Pose —/)).toBeNull()
  })

  it('the CELL section holds ONLY collision (no size/colour controls leak into it)', () => {
    render(<PropertiesPanel collision={false} onCollision={jest.fn()} tile={floorTile()} level={1} levelCount={1} onLevel={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'Blocked' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Walkable' })).toBeInTheDocument()
  })

  it('the TILE section is ONE consolidated group: change-tile + colour + W/H/D/Zoom + x/y/rotate/flip', () => {
    render(<PropertiesPanel collision={false} onCollision={jest.fn()} tile={floorTile()} level={1} levelCount={1} onLevel={jest.fn()} />)
    // which-tile + swap (the entity "Open Tile Library" affordance)
    expect(screen.getByRole('button', { name: /Open Tile Library/i })).toBeInTheDocument()
    // ONE colour (not two)
    expect(screen.getAllByLabelText(/colour/i).length).toBe(1)
    // scale axes
    for (const axis of ['Width', 'Height', 'Depth', 'Zoom']) {
      expect(screen.getByLabelText(axis)).toBeInTheDocument()
    }
    // pose axes live in the SAME group (no separate POSE divider)
    for (const axis of ['x', 'y', 'rotate']) {
      expect(screen.getByLabelText(axis)).toBeInTheDocument()
    }
    expect(screen.getByLabelText('flip horizontally')).toBeInTheDocument()
  })

  it('a cell with no tile shows ONLY the CELL section', () => {
    render(<PropertiesPanel collision={true} onCollision={jest.fn()} tile={null} level={1} levelCount={0} onLevel={jest.fn()} />)
    expect(dividerList()).toEqual(['— cell —'])
    expect(screen.queryByText(/^— tile/)).toBeNull()
  })
})

describe('Cell inspector — selected tile drives the TILE section', () => {
  it('the TILE header names the SELECTED tile (wall), not the whole stack', () => {
    const wall = floorTile({ key: 'tile-0', label: 'wall', colorFallback: '#ffffff' })
    render(<PropertiesPanel collision={true} onCollision={jest.fn()} tile={wall} level={2} levelCount={2} onLevel={jest.fn()} />)
    expect(dividerList()).toEqual(['— cell —', '— tile · wall —'])
  })

  it('a >1 stack shows the level stepper and steps up/down by 0-based index', () => {
    const onLevel = jest.fn()
    // 3-tall stack, currently on the MIDDLE tile (level 2 of 3).
    render(<PropertiesPanel collision={true} onCollision={jest.fn()} tile={floorTile({ label: 'wall' })} level={2} levelCount={3} onLevel={onLevel} />)
    expect(screen.getByText('level 2/3')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Higher tile' }))
    expect(onLevel).toHaveBeenLastCalledWith(2) // 0-based index of level 3

    fireEvent.click(screen.getByRole('button', { name: 'Lower tile' }))
    expect(onLevel).toHaveBeenLastCalledWith(0) // 0-based index of level 1 (floor)
  })

  it('no stepper on a single-tile stack', () => {
    render(<PropertiesPanel collision={false} onCollision={jest.fn()} tile={floorTile()} level={1} levelCount={1} onLevel={jest.fn()} />)
    expect(screen.queryByRole('button', { name: 'Higher tile' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Lower tile' })).toBeNull()
  })

  it('the "Open Tile Library" control fires onOpenLibrary (change-tile entry point)', () => {
    const onOpenLibrary = jest.fn()
    render(<PropertiesPanel collision={false} onCollision={jest.fn()} tile={floorTile({ onOpenLibrary })} level={1} levelCount={1} onLevel={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Open Tile Library/i }))
    expect(onOpenLibrary).toHaveBeenCalledTimes(1)
  })

  it('editing a TILE dim/pose writes through the tile callbacks (not a stale per-stack writer)', () => {
    const onDim = jest.fn()
    const onPose = jest.fn()
    render(<PropertiesPanel collision={false} onCollision={jest.fn()} tile={floorTile({ onDim, onPose })} level={1} levelCount={1} onLevel={jest.fn()} />)
    fireEvent.change(within(screen.getByText('Width').closest('label')!).getByLabelText('Width value'), { target: { value: '2' } })
    expect(onDim).toHaveBeenCalledWith('width', 2)
    fireEvent.click(screen.getByLabelText('flip horizontally'))
    expect(onPose).toHaveBeenCalledWith(expect.objectContaining({ flip: true }))
  })
})
