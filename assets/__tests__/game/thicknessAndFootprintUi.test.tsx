/**
 * THICKNESS AND FOOTPRINT ARE ONE CONTROL SHAPE, AND THEIR ARROWS MATCH THE VIEW.
 *
 * Alexander: "I pefer thickness UI to work like z-width UI … plus, the direction should match and be aligned
 * with the current cammera rotation, I rotated and the direction the propreties in the UI were showing didn't
 * match the view."
 *
 * So both controls ask the SAME question — "how far does this tile reach toward ⟨arrow⟩?" — and differ only
 * in unit:
 *   FOOTPRINT  whole CELLS, minimum 1 (a tile always occupies its own cell)
 *   THICKNESS  within ONE cell, maximum 1 (1 = all the way to that face)
 *
 * And the arrows are SCREEN directions. The glyph stays where it is in the 2×2 grid (↖ is always the up-left
 * corner, matching where the block grows on screen) while the WORLD axis under it is re-derived per camera
 * facing — so clicking the arrow you can see edits the axis you are looking at, while STORAGE stays
 * world-space (which is what keeps a door thin toward its own wall as you rotate).
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { TileControls, type TileControlModel } from '@/components/game/editorChrome'
import { rotateDepthDir, type DepthDir } from '@/engine/render/isoBlock'

const baseTile = (overrides: Partial<TileControlModel> = {}): TileControlModel => ({
  key: 'tile-0',
  label: 'door',
  dims: { width: 1, height: 1, depth: 1, zoom: 1 },
  color: null,
  colorFallback: '#ffffff',
  onDim: jest.fn(),
  onColor: jest.fn(),
  onClearColor: jest.fn(),
  override: null,
  styleName: 'Emoji',
  onOpenLibrary: jest.fn(),
  pose: { dx: 0, dy: 0, rot: 0 },
  onPose: jest.fn(),
  onPoseReset: jest.fn(),
  zWidth: 1,
  zBack: 0,
  zPerp: 0,
  zPerpBack: 0,
  zDir: 'right-down',
  onZWidth: jest.fn(),
  onZBack: jest.fn(),
  onZPerp: jest.fn(),
  onZPerpBack: jest.fn(),
  onZDir: jest.fn(),
  zIndex: 0,
  onZIndex: jest.fn(),
  thickness: '{}',
  onThicknessReach: jest.fn(),
  facing: 0,
  ...overrides,
})

const ARROWS = ['up-left', 'up-right', 'down-left', 'down-right'] as const

describe('Thickness looks like Footprint — four arrow rows, not a slider and some buttons', () => {
  it('renders one slider per direction, in its own group', () => {
    render(<TileControls tile={baseTile()} />)
    expect(screen.getByRole('group', { name: 'Thickness per direction' })).toBeInTheDocument()
    for (const dir of ARROWS) {
      expect(screen.getByLabelText(`Thickness ${dir}`)).toBeInTheDocument()
      expect(screen.getByLabelText(`Thickness ${dir} value`)).toBeInTheDocument()
    }
  })

  it('reaches all the way by default — 1, like a full cell', () => {
    render(<TileControls tile={baseTile()} />)
    for (const dir of ARROWS) expect(screen.getByLabelText(`Thickness ${dir}`)).toHaveValue('1')
  })

  it('shows a reduced reach where the tile has one', () => {
    render(<TileControls tile={baseTile({ thickness: JSON.stringify({ 'right-up': 0.3 }) })} />)
    expect(screen.getByLabelText('Thickness up-right')).toHaveValue('0.3')
    expect(screen.getByLabelText('Thickness down-left')).toHaveValue('1') // the others are untouched
  })

  it('never reaches past its own cell, and never to nothing', () => {
    render(<TileControls tile={baseTile()} />)
    const slider = screen.getByLabelText('Thickness down-right')
    expect(slider).toHaveAttribute('max', '1')
    expect(slider).toHaveAttribute('min', '0.05')
  })

  it('writes the reach for the direction whose slider moved', () => {
    const onThicknessReach = jest.fn()
    render(<TileControls tile={baseTile({ onThicknessReach })} />)
    fireEvent.change(screen.getByLabelText('Thickness down-right'), { target: { value: '0.3' } })
    expect(onThicknessReach).toHaveBeenLastCalledWith('right-down', 0.3)
  })

  it('sits beside the Footprint, which asks the same question in cells', () => {
    render(<TileControls tile={baseTile()} />)
    expect(screen.getByRole('group', { name: 'Thickness per direction' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Footprint per direction' })).toBeInTheDocument()
  })

  it('reports a mixed multi-selection instead of showing one tile\'s reaches', () => {
    render(<TileControls tile={baseTile({ thickness: null })} />)
    for (const dir of ARROWS) expect(screen.getByLabelText(`Thickness ${dir}`)).toHaveValue('1')
  })
})

describe('the arrows follow the camera — what you see is what you edit', () => {
  it.each([0, 1, 2, 3])('Thickness ↘ edits the axis seen as ↘ at facing %i', facing => {
    const onThicknessReach = jest.fn()
    render(<TileControls tile={baseTile({ facing, onThicknessReach })} />)
    fireEvent.change(screen.getByLabelText('Thickness down-right'), { target: { value: '0.4' } })
    expect(onThicknessReach).toHaveBeenLastCalledWith(rotateDepthDir('right-down', -facing), 0.4)
  })

  it.each([0, 1, 2, 3])('Footprint ↘ edits the axis seen as ↘ at facing %i', facing => {
    const onZWidth = jest.fn(), onZBack = jest.fn(), onZPerp = jest.fn(), onZPerpBack = jest.fn()
    // With the primary axis pinned to what ↘ currently means, ↘ is always the FORWARD end.
    const zDir = rotateDepthDir('right-down', -facing) as DepthDir
    render(<TileControls tile={baseTile({ facing, zDir, onZWidth, onZBack, onZPerp, onZPerpBack })} />)
    fireEvent.change(screen.getByLabelText('Footprint down-right'), { target: { value: '3' } })
    expect(onZWidth).toHaveBeenLastCalledWith(3)
  })

  it('a rotated camera moves which world axis each glyph writes', () => {
    const at0 = jest.fn(), at1 = jest.fn()
    const { unmount } = render(<TileControls tile={baseTile({ facing: 0, onThicknessReach: at0 })} />)
    fireEvent.change(screen.getByLabelText('Thickness up-left'), { target: { value: '0.5' } })
    unmount()
    render(<TileControls tile={baseTile({ facing: 1, onThicknessReach: at1 })} />)
    fireEvent.change(screen.getByLabelText('Thickness up-left'), { target: { value: '0.5' } })
    expect(at0.mock.calls[0][0]).not.toBe(at1.mock.calls[0][0])
  })
})

describe('Footprint counts CELLS, and one cell is the minimum', () => {
  it('a tile occupying only its own cell reads 1 in every direction, not 0', () => {
    render(<TileControls tile={baseTile()} />)
    for (const dir of ARROWS) expect(screen.getByLabelText(`Footprint ${dir}`)).toHaveValue('1')
  })

  it('the slider cannot go below one cell', () => {
    render(<TileControls tile={baseTile()} />)
    expect(screen.getByLabelText('Footprint down-right')).toHaveAttribute('min', '1')
  })

  it('a 3-cell span along the primary axis reads 3', () => {
    render(<TileControls tile={baseTile({ zWidth: 3 })} />)
    expect(screen.getByLabelText('Footprint down-right')).toHaveValue('3')
  })

  it('setting the primary axis to 3 cells writes a depth of 3', () => {
    const onZWidth = jest.fn()
    render(<TileControls tile={baseTile({ onZWidth })} />)
    fireEvent.change(screen.getByLabelText('Footprint down-right'), { target: { value: '3' } })
    expect(onZWidth).toHaveBeenLastCalledWith(3)
  })

  it('setting a perpendicular direction to 3 cells writes an extent of 2', () => {
    const onZPerp = jest.fn()
    render(<TileControls tile={baseTile({ onZPerp })} />)
    fireEvent.change(screen.getByLabelText('Footprint down-left'), { target: { value: '3' } })
    expect(onZPerp).toHaveBeenLastCalledWith(2)
  })

  it('still says in plain words how many cells the tile covers', () => {
    render(<TileControls tile={baseTile({ zWidth: 2, zPerp: 1 })} />)
    expect(screen.getByText(/covers 2 × 2 cells/)).toBeInTheDocument()
  })
})
