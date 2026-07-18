import { render, screen, fireEvent } from '@testing-library/react'
import { FloatingPanel } from '@/components/game/modals'
import { TileControls, type TileControlModel } from '@/components/game/editorChrome'

// ───────────────────────────────────────────────────────────────────────────
// TILE-SETTINGS panel (FloatingPanel + TileControls) — the draggable, resizable,
// NON-BLOCKING settings panel the user asked for: "we need to be able to move to
// see the tile change in realtime". We drive the REAL FloatingPanel wrapping the
// REAL TileControls body, and assert:
//   • it renders WITHOUT a blocking backdrop (non-modal — the canvas stays live),
//   • dragging the header MOVES it (so it can be tucked aside),
//   • dragging the corner grip RESIZES it,
//   • edits still fan out to the setting writers (live-updating).
// ───────────────────────────────────────────────────────────────────────────

const makeTile = (over: Partial<TileControlModel> = {}): TileControlModel => ({
  key: 'tile-0',
  label: 'wall',
  dims: { width: 1, height: 1, depth: 1, zoom: 1 },
  color: '#8a8a8a',
  colorFallback: '#8a8a8a',
  onDim: jest.fn(),
  onColor: jest.fn(),
  styleName: 'Emoji',
  onOpenLibrary: jest.fn(),
  ...over,
})

describe('FloatingPanel — tile settings', () => {
  it('renders the title + body without a blocking backdrop (non-modal)', () => {
    render(
      <FloatingPanel title="wall — Settings" accent="cyan" onClose={() => {}}>
        <TileControls tile={makeTile()} />
      </FloatingPanel>,
    )
    const dialog = screen.getByRole('dialog', { name: 'wall — Settings' })
    // NON-BLOCKING: a normal modal is aria-modal + a fixed inset-0 backdrop that eats clicks; this must be
    // neither, so the canvas behind stays pannable and the tile stays visible/clickable.
    expect(dialog).not.toHaveAttribute('aria-modal')
    expect(document.querySelector('.inset-0')).toBeNull()
    expect(document.querySelector('.bg-black\\/70')).toBeNull()
    // The real settings controls are present (Width/Height sliders, colour).
    expect(screen.getByLabelText('Width')).toBeInTheDocument()
    expect(screen.getByLabelText('Height')).toBeInTheDocument()
  })

  it('is positioned as a floating fixed panel with an explicit size', () => {
    render(
      <FloatingPanel title="wall — Settings" onClose={() => {}} initialPos={{ x: 200, y: 120 }} initialSize={{ w: 360, h: 420 }}>
        <TileControls tile={makeTile()} />
      </FloatingPanel>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.style.left).toBe('200px')
    expect(dialog.style.top).toBe('120px')
    expect(dialog.style.width).toBe('360px')
    expect(dialog.style.height).toBe('420px')
  })

  it('DRAGS: grabbing the header and moving the pointer repositions the panel', () => {
    render(
      <FloatingPanel title="wall — Settings" onClose={() => {}} initialPos={{ x: 200, y: 120 }} initialSize={{ w: 340, h: 440 }}>
        <TileControls tile={makeTile()} />
      </FloatingPanel>,
    )
    const dialog = screen.getByRole('dialog')
    const header = dialog.querySelector('[data-drag-handle]') as HTMLElement
    expect(header).toBeTruthy()

    fireEvent.mouseDown(header, { clientX: 250, clientY: 140 })
    // The move fires on WINDOW (so the drag keeps tracking off the panel, over the canvas).
    fireEvent.mouseMove(window, { clientX: 320, clientY: 200 })
    expect(dialog.style.left).toBe('270px') // 200 + (320-250)
    expect(dialog.style.top).toBe('180px') // 120 + (200-140)
    fireEvent.mouseUp(window)
    // After release, further pointer moves no longer drag it.
    fireEvent.mouseMove(window, { clientX: 500, clientY: 500 })
    expect(dialog.style.left).toBe('270px')
  })

  it('RESIZES: dragging the corner grip changes width + height', () => {
    render(
      <FloatingPanel title="wall — Settings" onClose={() => {}} initialPos={{ x: 100, y: 100 }} initialSize={{ w: 340, h: 440 }}>
        <TileControls tile={makeTile()} />
      </FloatingPanel>,
    )
    const dialog = screen.getByRole('dialog')
    const grip = dialog.querySelector('[data-resize-handle]') as HTMLElement
    expect(grip).toBeTruthy()

    fireEvent.mouseDown(grip, { clientX: 440, clientY: 540 })
    fireEvent.mouseMove(window, { clientX: 540, clientY: 620 })
    expect(dialog.style.width).toBe('440px') // 340 + 100
    expect(dialog.style.height).toBe('520px') // 440 + 80
    fireEvent.mouseUp(window)
  })

  it('clamps resize to a minimum so the panel never collapses', () => {
    render(
      <FloatingPanel title="wall — Settings" onClose={() => {}} initialPos={{ x: 100, y: 100 }} initialSize={{ w: 340, h: 440 }}>
        <TileControls tile={makeTile()} />
      </FloatingPanel>,
    )
    const dialog = screen.getByRole('dialog')
    const grip = dialog.querySelector('[data-resize-handle]') as HTMLElement
    fireEvent.mouseDown(grip, { clientX: 440, clientY: 540 })
    fireEvent.mouseMove(window, { clientX: 0, clientY: 0 }) // yank far up-left
    expect(dialog.style.width).toBe('260px') // FLOATING_MIN.w
    expect(dialog.style.height).toBe('200px') // FLOATING_MIN.h
    fireEvent.mouseUp(window)
  })

  it('LIVE edits: changing a slider still calls the setting writer while floating', () => {
    const onDim = jest.fn()
    render(
      <FloatingPanel title="wall — Settings" onClose={() => {}}>
        <TileControls tile={makeTile({ onDim })} />
      </FloatingPanel>,
    )
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '2.5' } })
    expect(onDim).toHaveBeenCalledWith('width', 2.5)
  })

  it('closes from the ✕ button and on Escape', () => {
    const onClose = jest.fn()
    render(
      <FloatingPanel title="wall — Settings" onClose={onClose}>
        <TileControls tile={makeTile()} />
      </FloatingPanel>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
