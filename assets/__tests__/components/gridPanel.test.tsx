/**
 * THE GRID's controls, the matrix inside New world, the thickness in the view bar.
 *
 *   > the UX experience from ground tickness is bad, plus the ground thicknes is not a per template
 *   > setting, is just a general setting of the grid. It doesn't allow me to delete number, it doesn't
 *   > update the thickness in real time, in short is bug, when I click build this world is reset to 1
 *   > ... we should add an option in the main sidebar related specifically to the grid
 *
 * The matrix tests came over from `generateControls.test.tsx` unchanged in intent: the numbers are still a
 * draft, the panel still refuses to quietly rewrite a size, and it still counts whatever you type. What is
 * NEW here is the two things reported as broken, a field you can empty, and a thickness that lands as
 * you type.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { MapMatrixSection, GroundThicknessControl, NumberField } from '@/components/game/gridPanel'
import { MAP_SIZE_MAX } from '@/lib/mapSize'

const SIZE = { cols: 40, rows: 34, cellSize: 16 }
const SETTINGS = { ...SIZE, slabBlocks: 1 }
const noop = () => {}

function panel(over: { settings?: typeof SETTINGS } & Partial<React.ComponentProps<typeof MapMatrixSection>> = {}) {
  const { settings = SETTINGS, ...rest } = over
  const props = {
    draft: { cols: settings.cols, rows: settings.rows, cellSize: settings.cellSize },
    size: SIZE,
    onDraft: jest.fn(),
    onResize: jest.fn(),
    ...rest,
  }
  render(<MapMatrixSection {...props} />)
  return props
}

/** The thickness control is its own thing now, in the view bar. */
function ground(blocks = 1) {
  const onBlocks = jest.fn()
  render(<GroundThicknessControl blocks={blocks} onBlocks={onBlocks} />)
  return onBlocks
}

const columns = () => screen.getByLabelText('Map columns')
const rows = () => screen.getByLabelText('Map rows')
const cellPx = () => screen.getByLabelText('Cell size in pixels')
const thickness = () => screen.getByLabelText('Ground thickness in blocks')

describe('a number field you can actually empty', () => {
  it('keeps the field EMPTY while you clear it, instead of snapping the old value back', () => {
    const onCommit = jest.fn()
    render(<NumberField label="Thickness" value={3} onCommit={onCommit} />)
    const field = screen.getByLabelText('Thickness') as HTMLInputElement

    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '' } })

    expect(field.value).toBe('') // the bug: this used to read "3" again
    expect(onCommit).not.toHaveBeenCalled() // and nothing is committed from a blank field
  })

  it('commits a number as soon as it is a number, so the map follows as you type', () => {
    const onCommit = jest.fn()
    render(<NumberField label="Thickness" value={1} onCommit={onCommit} />)
    const field = screen.getByLabelText('Thickness')

    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '8' } })
    expect(onCommit).toHaveBeenCalledWith(8)
  })

  it('lets you type a two-digit number without the first digit being fought', () => {
    const onCommit = jest.fn()
    render(<NumberField label="Columns" value={4} onCommit={onCommit} />)
    const field = screen.getByLabelText('Columns') as HTMLInputElement

    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.change(field, { target: { value: '1' } })
    fireEvent.change(field, { target: { value: '12' } })

    expect(field.value).toBe('12')
    expect(onCommit).toHaveBeenLastCalledWith(12)
  })

  it('refuses a value below its floor without erasing what you typed', () => {
    const onCommit = jest.fn()
    render(<NumberField label="Thickness" value={2} min={0} onCommit={onCommit} />)
    const field = screen.getByLabelText('Thickness') as HTMLInputElement

    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '-3' } })
    expect(onCommit).not.toHaveBeenCalled()
    expect(field.value).toBe('-3') // still yours to fix; the map simply did not take it
  })

  it('restores the map value on blur, so the field can never lie about the map', () => {
    const onCommit = jest.fn()
    render(<NumberField label="Thickness" value={5} onCommit={onCommit} />)
    const field = screen.getByLabelText('Thickness') as HTMLInputElement

    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)
    expect(field.value).toBe('5')
  })

  it('follows the value when something ELSE changes it while the field is idle', () => {
    const { rerender } = render(<NumberField label="Thickness" value={1} onCommit={noop} />)
    rerender(<NumberField label="Thickness" value={7} onCommit={noop} />)
    expect((screen.getByLabelText('Thickness') as HTMLInputElement).value).toBe('7')
  })
})

describe('the matrix, a draft, not an edit', () => {
  it('exposes all three matrix variables', () => {
    panel()
    expect(columns()).toHaveValue(40)
    expect(rows()).toHaveValue(34)
    expect(cellPx()).toHaveValue(16)
  })

  it('totals the matrix and says what columns means', () => {
    panel()
    expect(screen.getByText(/40 × 34 = 1,360 cells/)).toBeInTheDocument()
    expect(screen.getByText(/how many cells fit in one row/i)).toBeInTheDocument()
  })

  it('does NOT touch the open map while you type, it reports a draft', () => {
    const props = panel()
    fireEvent.change(columns(), { target: { value: '60' } })
    expect(props.onResize).not.toHaveBeenCalled()
    expect(props.onDraft).toHaveBeenCalledWith({ cols: 60, rows: 34, cellSize: 16 })
  })

  it('offers no resize button while the draft matches the open map', () => {
    panel()
    expect(screen.queryByRole('button', { name: /resize this map/i })).not.toBeInTheDocument()
  })

  it('applies all three numbers together when you do resize', () => {
    const props = panel({ settings: { cols: 60, rows: 20, cellSize: 24, slabBlocks: 1 } })
    fireEvent.click(screen.getByRole('button', { name: /resize this map/i }))
    expect(props.onResize).toHaveBeenCalledWith(60, 20, 24)
  })

  it('counts any size you type, however big, the field never refuses to do arithmetic', () => {
    panel({ settings: { cols: 400, rows: 240, cellSize: 16, slabBlocks: 1 } })
    expect(screen.getByText(/400 × 240 = 96,000 cells/)).toBeInTheDocument()
  })

  it('SAYS a size is over the cap instead of quietly building a smaller one', () => {
    panel({ settings: { cols: MAP_SIZE_MAX + 1, rows: 20, cellSize: 16, slabBlocks: 1 } })
    // It NAMES the offending number rather than clamping it, the silent rewrite is the bug this guards.
    expect(screen.getByText(new RegExp(`Columns is ${MAP_SIZE_MAX + 1}`))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resize this map/i })).toBeDisabled()
  })

  it('tells you a resize clears the map, and that building does not need one first', () => {
    panel({ settings: { cols: 60, rows: 34, cellSize: 16, slabBlocks: 1 } })
    expect(screen.getByText(/Resizing clears the map/i)).toBeInTheDocument()
    expect(screen.getByText(/without clearing anything first/i)).toBeInTheDocument()
  })
})

describe('the ground control, in the view bar beside Rotate and Range', () => {
  it("shows the map's own thickness", () => {
    ground(5)
    expect(screen.getByLabelText('Ground thickness in blocks')).toHaveValue(5)
  })

  it('applies on the spot, it rebuilds nothing, so it needs no button', () => {
    const onBlocks = ground(1)
    fireEvent.change(screen.getByLabelText('Ground thickness in blocks'), { target: { value: '9' } })
    expect(onBlocks).toHaveBeenCalledWith(9)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('accepts zero, a map laid flat', () => {
    const onBlocks = ground(3)
    fireEvent.change(screen.getByLabelText('Ground thickness in blocks'), { target: { value: '0' } })
    expect(onBlocks).toHaveBeenCalledWith(0)
  })

  it('refuses a negative thickness, there is no such map', () => {
    const onBlocks = ground(2)
    fireEvent.change(screen.getByLabelText('Ground thickness in blocks'), { target: { value: '-2' } })
    expect(onBlocks).not.toHaveBeenCalled()
  })

  it('can be emptied while you retype it', () => {
    const onBlocks = ground(4)
    const field = screen.getByLabelText('Ground thickness in blocks') as HTMLInputElement
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '' } })
    expect(field.value).toBe('')
    expect(onBlocks).not.toHaveBeenCalled()
  })

  it('says an empty map will show no change, because the body is only visible at the edges', () => {
    ground(1)
    expect(screen.getByTitle(/empty map shows nothing/i)).toBeInTheDocument()
  })
})
