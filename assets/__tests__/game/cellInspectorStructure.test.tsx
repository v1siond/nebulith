/**
 * CELL inspector STRUCTURE — the reworked inspector is a COMPACT SUMMARY that opens the full tile settings
 * in a MODAL (mirroring the tile-animation modal). Two things are asserted here:
 *
 *   1. SUMMARY (PropertiesPanel) — still EXACTLY TWO sections (CELL = collision; TILE = the one selected
 *      tile), but the TILE section is now a compact summary: Open Tile Library + a colour swatch + the
 *      "Edit settings…" button (opens the modal) + Animate + Remove. The heavy per-axis controls are GONE
 *      from the summary — they moved into the modal.
 *   2. SETTINGS BODY (TileControls) — the modal body renders EVERY setting: colour, Width/Height/Zoom, the
 *      Z Width directional depth + z-position pickers for asset tiles, x/y/rotate/flip, Z-Index, Display.
 *
 * Plus Part A: the numeric fields accept an EMPTY transient value (so you can clear + retype) and values
 * BELOW the slider min / ABOVE the max (the typed number is honored, no hard clamp) and write them through.
 */
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PropertiesPanel, TileControls, type TileControlModel } from '@/components/game/editorChrome'
import { Modal } from '@/components/game/modals'

/** A minimal floor-tile model (level 0), with a pose so x/y/rotate/flip render in the settings body. */
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

/** An asset-tile model (level ≥1) carrying the directional-depth + z-index writers a wall/prop gets. */
function assetTile(overrides: Partial<TileControlModel> = {}): TileControlModel {
  return floorTile({
    key: 'tile-0',
    label: 'wall',
    colorFallback: '#ffffff',
    zWidth: 1,
    zDir: null,
    onZWidth: jest.fn(),
    onZDir: jest.fn(),
    zPos: 0,
    zPosDir: null,
    onZPos: jest.fn(),
    onZPosDir: jest.fn(),
    zIndex: 0,
    onZIndex: jest.fn(),
    ...overrides,
  })
}

/** Render the inspector summary with a stub onOpenSettings unless the caller overrides it. */
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

/** The ordered list of section-divider texts the inspector renders (the `— … —` headings). */
function dividerList(): string[] {
  return screen
    .getAllByText((_content, el) => {
      const t = el?.textContent?.trim() ?? ''
      return el?.tagName === 'P' && /^—\s.+\s—$/.test(t)
    })
    .filter(el => el.tagName === 'P')
    .map(el => el.textContent!.trim())
}

describe('Cell inspector summary — exactly two sections', () => {
  it('a bare grass cell renders EXACTLY [CELL, TILE·grass]', () => {
    renderPanel()
    expect(dividerList()).toEqual(['— cell —', '— tile · grass —'])
    expect(screen.queryByText(/^— floor/i)).toBeNull()
    expect(screen.queryByText(/^— wall/i)).toBeNull()
  })

  it('the CELL section holds ONLY collision', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: 'Blocked' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Walkable' })).toBeInTheDocument()
  })

  it('the TILE summary keeps Open Tile Library + a single colour swatch + the Edit settings button', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /Open Tile Library/i })).toBeInTheDocument()
    expect(screen.getAllByLabelText(/colour/i).length).toBe(1)
    expect(screen.getByRole('button', { name: /Edit settings/i })).toBeInTheDocument()
  })

  it('the heavy per-axis controls are NOT in the summary — they moved into the modal', () => {
    renderPanel()
    // no sliders / number fields leak into the compact summary
    expect(screen.queryByLabelText('Width')).toBeNull()
    expect(screen.queryByLabelText('Width value')).toBeNull()
    expect(screen.queryByLabelText('Height')).toBeNull()
    expect(screen.queryByLabelText('Zoom')).toBeNull()
    expect(screen.queryByLabelText('x')).toBeNull()
    expect(screen.queryByLabelText('flip horizontally')).toBeNull()
  })

  it('"Edit settings…" fires onOpenSettings (opens the modal)', () => {
    const onOpenSettings = jest.fn()
    renderPanel({ onOpenSettings })
    fireEvent.click(screen.getByRole('button', { name: /Edit settings/i }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('"Open Tile Library" fires onOpenLibrary (change-tile entry point)', () => {
    const onOpenLibrary = jest.fn()
    renderPanel({ tile: floorTile({ onOpenLibrary }) })
    fireEvent.click(screen.getByRole('button', { name: /Open Tile Library/i }))
    expect(onOpenLibrary).toHaveBeenCalledTimes(1)
  })

  it('a cell with no tile shows ONLY the CELL section', () => {
    renderPanel({ tile: null, collision: true, levelCount: 0 })
    expect(dividerList()).toEqual(['— cell —'])
    expect(screen.queryByText(/^— tile/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Edit settings/i })).toBeNull()
  })

  it('the TILE header names the SELECTED tile (wall), not the whole stack', () => {
    renderPanel({ tile: assetTile(), collision: true, level: 2, levelCount: 2 })
    expect(dividerList()).toEqual(['— cell —', '— tile · wall —'])
  })

  it('a >1 stack shows the level stepper and steps up/down by 0-based index', () => {
    const onLevel = jest.fn()
    renderPanel({ tile: assetTile(), collision: true, level: 2, levelCount: 3, onLevel })
    expect(screen.getByText('level 2/3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Higher tile' }))
    expect(onLevel).toHaveBeenLastCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: 'Lower tile' }))
    expect(onLevel).toHaveBeenLastCalledWith(0)
  })

  it('no stepper on a single-tile stack', () => {
    renderPanel()
    expect(screen.queryByRole('button', { name: 'Higher tile' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Lower tile' })).toBeNull()
  })

  it('an asset tile keeps its "Animate…" entry (fires onOpenAnimator) + a Remove button', () => {
    const onOpenAnimator = jest.fn()
    const onRemove = jest.fn()
    renderPanel({ tile: assetTile({ onOpenAnimator, animations: [] }), collision: true, level: 2, levelCount: 2, onRemove })
    fireEvent.click(screen.getByRole('button', { name: /Animate tile/i }))
    expect(onOpenAnimator).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Remove tile/i }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})

describe('Tile settings body (TileControls) — every setting renders + writes through', () => {
  it('a floor tile shows colour + Width/Height/Zoom + x/y/rotate/flip, and NO Depth / Z Width', () => {
    render(<TileControls tile={floorTile()} />)
    expect(screen.getAllByLabelText(/colour/i).length).toBe(1)
    for (const axis of ['Width', 'Height', 'Zoom']) {
      expect(screen.getByLabelText(axis)).toBeInTheDocument()
    }
    expect(screen.queryByLabelText('Depth')).toBeNull()
    expect(screen.queryByLabelText('Z Width')).toBeNull()
    for (const axis of ['x', 'y', 'rotate']) {
      expect(screen.getByLabelText(axis)).toBeInTheDocument()
    }
    expect(screen.getByLabelText('flip horizontally')).toBeInTheDocument()
  })

  it('EVERY dimension slider drags down to 0 — the slider is the control, not a fallback to typing', () => {
    // Alexander: "the slider should allow me to reach 0, it only goes down to 0.25" / "I requested to
    // explicitly be able to drag sliders to 0". A dimension is a measurement and 0 is a value it can hold
    // (a flat tile is 0 blocks tall) — the slider has to cover its own range without deferring to the box.
    render(<TileControls tile={assetTile()} />)
    for (const axis of ['Width', 'Height', 'Zoom']) {
      expect(screen.getByLabelText(axis)).toHaveAttribute('min', '0')
    }
    render(<TileControls tile={floorTile()} />)
    expect(screen.getAllByLabelText('Height')[0]).toHaveAttribute('min', '0')
  })

  it('the settings body does NOT carry Open Tile Library or Animate (those stay in the inspector)', () => {
    render(<TileControls tile={assetTile({ onOpenAnimator: jest.fn() })} />)
    expect(screen.queryByRole('button', { name: /Open Tile Library/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Animate tile/i })).toBeNull()
  })

  it('editing a dim/pose writes through the tile callbacks', () => {
    const onDim = jest.fn()
    const onPose = jest.fn()
    render(<TileControls tile={floorTile({ onDim, onPose })} />)
    fireEvent.change(within(screen.getByText('Width').closest('label')!).getByLabelText('Width value'), { target: { value: '2' } })
    expect(onDim).toHaveBeenCalledWith('width', 2)
    fireEvent.click(screen.getByLabelText('flip horizontally'))
    expect(onPose).toHaveBeenCalledWith(expect.objectContaining({ flip: true }))
  })

  it('an ASSET tile gets the Z Width directional-depth control (4 directions) + a z slide', () => {
    const onZWidth = jest.fn(), onZDir = jest.fn(), onZPos = jest.fn()
    render(<TileControls tile={assetTile({ onZWidth, onZDir, onZPos })} />)
    expect(screen.getByLabelText('Z Width')).toBeInTheDocument()
    expect(screen.queryByLabelText('Depth')).toBeNull()
    const zWidthGroup = within(screen.getByRole('group', { name: 'Z Width direction' }))
    for (const dir of ['right top', 'left top', 'bottom left', 'bottom right']) {
      expect(zWidthGroup.getByRole('button', { name: dir })).toBeInTheDocument()
    }
    expect(screen.getByLabelText('z')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Z Width'), { target: { value: '4' } })
    expect(onZWidth).toHaveBeenLastCalledWith(4)
    fireEvent.click(zWidthGroup.getByRole('button', { name: 'right top' }))
    expect(onZDir).toHaveBeenLastCalledWith('right-up')
    fireEvent.click(zWidthGroup.getByRole('button', { name: 'bottom left' }))
    expect(onZDir).toHaveBeenLastCalledWith('left-down')
  })

  it('an ASSET tile gets a z-POSITION direction picker (4 diagonals) wired to onZPosDir', () => {
    const onZPos = jest.fn(), onZPosDir = jest.fn()
    render(<TileControls tile={assetTile({ onZPos, onZPosDir })} />)
    const zPosGroup = within(screen.getByRole('group', { name: 'Z position direction' }))
    fireEvent.click(zPosGroup.getByRole('button', { name: 'right top' }))
    expect(onZPosDir).toHaveBeenLastCalledWith('right-up')
    fireEvent.click(zPosGroup.getByRole('button', { name: 'bottom right' }))
    expect(onZPosDir).toHaveBeenLastCalledWith('right-down')
    fireEvent.change(screen.getByLabelText('z'), { target: { value: '2' } })
    expect(onZPos).toHaveBeenLastCalledWith(2)
  })
})

describe('Part A — free numeric input (empty allowed + out-of-range honored)', () => {
  it('clearing a number field is allowed and does NOT write (value treated as unchanged)', () => {
    const onDim = jest.fn()
    render(<TileControls tile={floorTile({ onDim })} />)
    const width = screen.getByLabelText('Width value') as HTMLInputElement
    fireEvent.change(width, { target: { value: '' } })
    expect(width.value).toBe('') // the field can hold an empty string mid-edit
    expect(onDim).not.toHaveBeenCalled() // empty → unchanged, never coerced to 0
  })

  it('an emptied field reverts to the committed value on blur (unchanged)', () => {
    render(<TileControls tile={floorTile()} />)
    const width = screen.getByLabelText('Width value') as HTMLInputElement
    fireEvent.change(width, { target: { value: '' } })
    fireEvent.blur(width)
    expect(width.value).toBe('1') // snaps back to the committed dims.width
  })

  it('a value ABOVE the slider max is honored and written (no hard clamp)', () => {
    const onDim = jest.fn()
    render(<TileControls tile={floorTile({ onDim })} />)
    fireEvent.change(screen.getByLabelText('Width value'), { target: { value: '99' } }) // slider max is 5
    expect(onDim).toHaveBeenLastCalledWith('width', 99)
  })

  it('a value BELOW the slider min is honored and written', () => {
    const onDim = jest.fn()
    render(<TileControls tile={floorTile({ onDim })} />)
    fireEvent.change(screen.getByLabelText('Width value'), { target: { value: '0.05' } }) // slider min is 0.25
    expect(onDim).toHaveBeenLastCalledWith('width', 0.05)
  })

  it('a NEGATIVE value below the pose min is honored on a pose axis', () => {
    const onPose = jest.fn()
    render(<TileControls tile={floorTile({ onPose, pose: { dx: 0, dy: 0, rot: 0 } })} />)
    fireEvent.change(screen.getByLabelText('x value'), { target: { value: '-3' } }) // pose x slider is -1..1
    expect(onPose).toHaveBeenLastCalledWith(expect.objectContaining({ dx: -3 }))
  })

  it('Z-Index accepts a value above its slider max', () => {
    const onZIndex = jest.fn()
    render(<TileControls tile={assetTile({ onZIndex })} />)
    fireEvent.change(screen.getByLabelText('Z-Index value'), { target: { value: '250' } }) // slider max is 100
    expect(onZIndex).toHaveBeenLastCalledWith(250)
  })

  it('a lone "-" is held without writing (transient, not a number yet)', () => {
    const onPose = jest.fn()
    render(<TileControls tile={floorTile({ onPose, pose: { dx: 0, dy: 0, rot: 0 } })} />)
    const x = screen.getByLabelText('x value') as HTMLInputElement
    fireEvent.change(x, { target: { value: '-' } })
    expect(x.value).toBe('-')
    expect(onPose).not.toHaveBeenCalled()
  })
})

/** Faithful re-creation of the templates.tsx wiring: the inspector's Edit-settings button opens a Modal
 *  that hosts the TileControls settings body — the SAME pattern as the tile-animation modal. */
function SettingsModalHarness({ tile }: { tile: TileControlModel }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <PropertiesPanel collision={false} onCollision={jest.fn()} tile={tile} level={1} levelCount={1} onLevel={jest.fn()} onOpenSettings={() => setOpen(true)} />
      {open && (
        <Modal title={`${tile.label} — Settings`} accent="cyan" wide onClose={() => setOpen(false)}>
          <TileControls tile={tile} />
        </Modal>
      )}
    </>
  )
}

describe('Part B — the tile settings MODAL opens from the inspector and closes', () => {
  it('the settings are hidden until Edit settings is clicked, then the modal shows them', () => {
    render(<SettingsModalHarness tile={assetTile()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByLabelText('Width')).toBeNull() // the slider lives only in the modal

    fireEvent.click(screen.getByRole('button', { name: /Edit settings/i }))
    const dialog = within(screen.getByRole('dialog'))
    for (const axis of ['Width', 'Height', 'Zoom']) {
      expect(dialog.getByLabelText(axis)).toBeInTheDocument()
    }
    expect(dialog.getByLabelText('Z Width')).toBeInTheDocument()
    expect(dialog.getByLabelText('flip horizontally')).toBeInTheDocument()
    expect(dialog.getAllByLabelText(/colour/i).length).toBe(1)
  })

  it('closing the modal (✕) hides the settings again', () => {
    render(<SettingsModalHarness tile={assetTile()} />)
    fireEvent.click(screen.getByRole('button', { name: /Edit settings/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
