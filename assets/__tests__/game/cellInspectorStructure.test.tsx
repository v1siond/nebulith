/**
 * CELL inspector STRUCTURE (§4.7) — the inspector IS the settings now.
 *
 * §3.10 measured the previous shape as a flat summary hiding everything real behind an "Edit settings…"
 * modal. §4.7 replaces it with six accordions titled after the questions people ask — WHAT IS IT / HOW IT
 * LOOKS / SIZE & POSITION / HOW IT BEHAVES / ANIMATION / RULES — with the full control set INLINE and the
 * open/closed state remembered per section.
 *
 * Asserted here:
 *   1. STRUCTURE — the sections §4.7 draws, in its order, with the collapse actually hiding their contents.
 *   2. CONTENT — each control lands in the section that answers its question, and still writes through.
 *   3. The destructive footer stays OUT of every section, so it can never hide inside a collapsed one.
 *
 * Plus Part A: the numeric fields accept an EMPTY transient value (so you can clear + retype) and values
 * BELOW the slider min / ABOVE the max (the typed number is honored, no hard clamp) and write them through.
 */
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PropertiesPanel, TileControls, type TileControlModel } from '@/components/game/editorChrome'

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
      sectionOpen={() => true}
      onToggleSection={jest.fn()}
      {...props}
    />,
  )
}

/** The inspector's section headers, in DOM order — each accordion's toggle carries `aria-expanded`. */
function sectionList(): string[] {
  return screen
    .queryAllByRole('button', { expanded: true })
    .concat(screen.queryAllByRole('button', { expanded: false }))
    .filter(el => el.getAttribute('aria-expanded') !== null && el.getAttribute('aria-label'))
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map(el => el.getAttribute('aria-label')!)
}

describe('the inspector renders §4.7\'s sections', () => {
  it('draws them in the design\'s order for a cell holding a tile', () => {
    renderPanel({ tile: assetTile({ onOpenAnimator: jest.fn() }), onOpenTriggers: jest.fn() })
    expect(sectionList()).toEqual([
      'Tile', 'Appearance', 'Size & position', 'What is this?', 'Behaviour', 'Animation', 'Rules',
    ])
  })

  it('names WHAT you selected — a cell holds a Tile, a unit is a Character', () => {
    const { unmount } = renderPanel()
    expect(sectionList()[0]).toBe('Tile')
    unmount()
    renderPanel({ unitSection: <p>unit extras</p> })
    expect(sectionList()[0]).toBe('Character')
  })

  it('keeps HOW IT BEHAVES for a cell holding NO tile — an empty cell can still be blocked', () => {
    renderPanel({ tile: null, collision: true, levelCount: 0 })
    expect(sectionList()).toEqual(['Behaviour'])
    expect(screen.getByRole('button', { name: 'Blocked' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('has no "Edit settings…" — §4.7 folded the modal\'s controls inline', () => {
    renderPanel()
    expect(screen.queryByRole('button', { name: /Edit settings/i })).toBeNull()
  })

  it('names the tile in the header, above every section', () => {
    renderPanel({ tile: assetTile(), level: 2, levelCount: 2 })
    expect(screen.getByText(/cell · wall/i)).toBeInTheDocument()
  })

  it('"Open Tile Library" fires onOpenLibrary (the change-tile entry point)', () => {
    const onOpenLibrary = jest.fn()
    renderPanel({ tile: floorTile({ onOpenLibrary }) })
    fireEvent.click(screen.getByRole('button', { name: /Open Tile Library/i }))
    expect(onOpenLibrary).toHaveBeenCalledTimes(1)
  })

  it('HOW IT LOOKS holds exactly one colour swatch', () => {
    renderPanel()
    expect(screen.getAllByLabelText(/colour/i).length).toBe(1)
  })

  it('SIZE & POSITION holds the per-axis controls that used to need a modal', () => {
    renderPanel({ tile: assetTile() })
    for (const label of ['Width', 'Height', 'Zoom', 'Left ↔ Right', 'Up ↕ Down', 'Rotate', 'Mirror', 'Draw order']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
    expect(screen.getByRole('group', { name: 'Footprint per direction' })).toBeInTheDocument()
  })

  it('the level stepper stays in the header — it says WHICH tile you are editing', () => {
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
  })
})

describe('collapsing a section hides its controls, and reports the toggle', () => {
  it('a closed section renders none of its body', () => {
    renderPanel({ tile: assetTile(), sectionOpen: id => id !== 'size' })
    expect(screen.queryByLabelText('Width')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Footprint per direction' })).toBeNull()
    expect(screen.getAllByLabelText(/colour/i).length).toBe(1)
  })

  it('announces open/closed on the header itself', () => {
    renderPanel({ tile: assetTile(), sectionOpen: id => id !== 'size' })
    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Size & position' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('reports WHICH section was clicked, so the caller can persist it', () => {
    const onToggleSection = jest.fn()
    renderPanel({ tile: assetTile(), onToggleSection })
    fireEvent.click(screen.getByRole('button', { name: 'Size & position' }))
    expect(onToggleSection).toHaveBeenCalledWith('size')
  })
})

describe('the destructive footer never hides inside a collapsed section', () => {
  it('shows Clear tiles + Remove tile with EVERY section closed', () => {
    renderPanel({ tile: assetTile(), sectionOpen: () => false, onClearTiles: jest.fn(), onRemove: jest.fn() })
    expect(screen.getByRole('button', { name: /Clear tiles/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remove tile/i })).toBeInTheDocument()
  })
})

/**
 * §3.13's genuine trap, and §4.7's instruction: *"The inert building-block panel (3.13) must either write
 * back or be replaced with an explicit … message. Rendering live controls over no-op handlers is worse than
 * showing nothing."*
 */
describe('a tile the editor cannot write to SAYS so, instead of faking controls (§3.13)', () => {
  const notice = "This tile is part of a generated object and can't be edited directly yet."

  it('shows the message and drops the two sections a no-op writer would fake', () => {
    renderPanel({ tile: assetTile(), tileNotice: notice })
    expect(screen.getByText(notice)).toBeInTheDocument()
    expect(sectionList()).not.toContain('Appearance')
    expect(sectionList()).not.toContain('Size & position')
    expect(screen.queryByLabelText('Width')).toBeNull()
  })

  it('keeps the controls that DO write: collision, the tile library, remove, clear', () => {
    const onRemove = jest.fn()
    renderPanel({ tile: assetTile(), tileNotice: notice, onRemove, onClearTiles: jest.fn() })
    expect(screen.getByRole('button', { name: 'Blocked' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open Tile Library/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Remove tile/i }))
    expect(onRemove).toHaveBeenCalled()
  })

  it('an ordinary tile carries no notice and keeps both sections', () => {
    renderPanel({ tile: assetTile() })
    expect(screen.queryByText(notice)).toBeNull()
    expect(sectionList()).toContain('Appearance')
    expect(sectionList()).toContain('Size & position')
  })
})

/**
 * The CONTROL BODIES (`TileControls`) — every setting renders and writes through.
 *
 * Rewritten for §4.7's labels. It used to name the pre-relabel controls (`x`, `y`, `flip horizontally`,
 * `Z Width left top`, `Z-Index`, `Z position direction`) — §3.10's jargon, which §4.7 replaced with
 * `Left ↔ Right`, `Up ↕ Down`, `Mirror`, `Footprint <direction>`, `Draw order` and `Slide <direction>`.
 * Asserting the old names tested a UI that no longer exists.
 */
describe('the control bodies — every setting renders + writes through', () => {
  it('a floor tile shows colour, the three scale axes and the nudge controls', () => {
    render(<TileControls tile={floorTile()} />)
    expect(screen.getAllByLabelText(/colour/i).length).toBeGreaterThan(0)
    for (const label of ['Width', 'Height', 'Zoom', 'Left ↔ Right', 'Up ↕ Down', 'Rotate', 'Mirror']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })

  it('a FLOOR gets no Footprint and no Draw order — the model wires it no writer for them', () => {
    render(<TileControls tile={floorTile()} />)
    expect(screen.queryByRole('group', { name: 'Footprint per direction' })).toBeNull()
    expect(screen.queryByLabelText('Draw order')).toBeNull()
  })

  it('EVERY dimension slider drags down to 0 — the slider is the control, not a fallback to typing', () => {
    render(<TileControls tile={floorTile()} />)
    for (const axis of ['Width', 'Height', 'Zoom']) {
      expect(screen.getByLabelText(axis)).toHaveAttribute('min', '0')
    }
  })

  it('the bodies do NOT carry Open Tile Library or Animate — those stay in the inspector header', () => {
    render(<TileControls tile={assetTile({ onOpenAnimator: jest.fn() })} />)
    expect(screen.queryByRole('button', { name: /Open Tile Library/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Animate tile/i })).toBeNull()
  })

  it('editing a dim or a nudge writes through the tile callbacks', () => {
    const onDim = jest.fn()
    const onPose = jest.fn()
    render(<TileControls tile={floorTile({ onDim, onPose })} />)
    fireEvent.change(screen.getByLabelText('Width value'), { target: { value: '2' } })
    expect(onDim).toHaveBeenCalledWith('width', 2)
    fireEvent.click(screen.getByLabelText('Mirror'))
    expect(onPose).toHaveBeenCalledWith(expect.objectContaining({ flip: true }))
  })

  it('an ASSET tile gets the FOOTPRINT control — four independent diagonals, each in CELLS', () => {
    const onZWidth = jest.fn()
    render(<TileControls tile={assetTile({ onZWidth, onZBack: jest.fn(), onZPerp: jest.fn(), onZPerpBack: jest.fn() })} />)
    const group = screen.getByRole('group', { name: 'Footprint per direction' })
    // Four sliders, one per iso diagonal, each labelled by the direction it reaches.
    expect(within(group).getAllByRole('slider')).toHaveLength(4)
  })

  it('an ASSET tile gets the SLIDE direction picker — the same four diagonals', () => {
    const onZPosDir = jest.fn()
    render(<TileControls tile={assetTile({ onZPos: jest.fn(), onZPosDir })} />)
    const group = screen.getByRole('group', { name: 'Slide direction' })
    const dirs = within(group).getAllByRole('button')
    expect(dirs).toHaveLength(4)
    fireEvent.click(dirs[1])
    expect(onZPosDir).toHaveBeenCalled()
  })

  it('an ASSET tile gets Draw order, and it writes whole numbers', () => {
    const onZIndex = jest.fn()
    render(<TileControls tile={assetTile({ onZIndex })} />)
    fireEvent.change(screen.getByLabelText('Draw order value'), { target: { value: '7' } })
    expect(onZIndex).toHaveBeenCalledWith(7)
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
    fireEvent.change(screen.getByLabelText('Left ↔ Right value'), { target: { value: '-3' } }) // pose x slider is -1..1
    expect(onPose).toHaveBeenLastCalledWith(expect.objectContaining({ dx: -3 }))
  })

  it('Z-Index accepts a value above its slider max', () => {
    const onZIndex = jest.fn()
    render(<TileControls tile={assetTile({ onZIndex })} />)
    fireEvent.change(screen.getByLabelText('Draw order value'), { target: { value: '250' } }) // slider max is 100
    expect(onZIndex).toHaveBeenLastCalledWith(250)
  })

  it('a lone "-" is held without writing (transient, not a number yet)', () => {
    const onPose = jest.fn()
    render(<TileControls tile={floorTile({ onPose, pose: { dx: 0, dy: 0, rot: 0 } })} />)
    const x = screen.getByLabelText('Left ↔ Right value') as HTMLInputElement
    fireEvent.change(x, { target: { value: '-' } })
    expect(x.value).toBe('-')
    expect(onPose).not.toHaveBeenCalled()
  })
})
