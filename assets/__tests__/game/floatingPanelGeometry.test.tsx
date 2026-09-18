/**
 * FloatingPanel GEOMETRY persistence, the user's ask: "move and resize [the modals] at will and I want
 * to save the position, size, as settings for the editor in the elixir backend."
 *
 * We drive the REAL FloatingPanel and assert:
 *   • it restores saved geometry on open (initialPos/initialSize come from the backend map),
 *   • it emits the FINAL geometry once at the END of a drag / resize (so the page can persist it),
 *   • the geometry ROUND-TRIPS to the editor-settings API, a drag PUTs {value:{x,y,w,h}} to
 *     /editor_settings/:key (fetch mocked), exactly what nebulith stores + restores.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FloatingPanel } from '@/components/game/modals'
import { saveEditorSetting } from '@/lib/editorSettings'

const dragHandle = () => screen.getByRole('dialog').querySelector('[data-drag-handle]') as HTMLElement
const resizeGrip = () => screen.getByRole('dialog').querySelector('[data-resize-handle]') as HTMLElement

describe('FloatingPanel, geometry restore + persist', () => {
  it('restores the saved geometry on open (position + size from the backend)', () => {
    render(
      <FloatingPanel title="Settings" onClose={() => {}} initialPos={{ x: 300, y: 150 }} initialSize={{ w: 420, h: 500 }}>
        <div>body</div>
      </FloatingPanel>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.style.left).toBe('300px')
    expect(dialog.style.top).toBe('150px')
    expect(dialog.style.width).toBe('420px')
    expect(dialog.style.height).toBe('500px')
  })

  it('emits the FINAL geometry once on drag-end', () => {
    const onGeometryChange = jest.fn()
    render(
      <FloatingPanel title="Settings" onClose={() => {}} initialPos={{ x: 200, y: 120 }} initialSize={{ w: 340, h: 440 }} onGeometryChange={onGeometryChange}>
        <div>body</div>
      </FloatingPanel>,
    )
    fireEvent.mouseDown(dragHandle(), { clientX: 250, clientY: 140 })
    fireEvent.mouseMove(window, { clientX: 330, clientY: 210 }) // +80, +70
    expect(onGeometryChange).not.toHaveBeenCalled() // only on release, not during
    fireEvent.mouseUp(window)
    expect(onGeometryChange).toHaveBeenCalledTimes(1)
    expect(onGeometryChange).toHaveBeenCalledWith({ x: 280, y: 190, w: 340, h: 440 })
  })

  it('emits the FINAL geometry once on resize-end', () => {
    const onGeometryChange = jest.fn()
    render(
      <FloatingPanel title="Settings" onClose={() => {}} initialPos={{ x: 100, y: 100 }} initialSize={{ w: 340, h: 440 }} onGeometryChange={onGeometryChange}>
        <div>body</div>
      </FloatingPanel>,
    )
    fireEvent.mouseDown(resizeGrip(), { clientX: 440, clientY: 540 })
    fireEvent.mouseMove(window, { clientX: 500, clientY: 600 }) // +60, +60
    fireEvent.mouseUp(window)
    expect(onGeometryChange).toHaveBeenCalledWith({ x: 100, y: 100, w: 400, h: 500 })
  })

  it('ROUND-TRIPS: a drag persists the new geometry via the editor-settings API (fetch mocked)', async () => {
    const origFetch = global.fetch
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ key: 'animation', value: {} }) })
    global.fetch = fetchMock as unknown as typeof fetch

    // Mirror the page wiring: onGeometryChange → saveEditorSetting(modalId, geometry).
    render(
      <FloatingPanel
        title="Animation"
        onClose={() => {}}
        initialPos={{ x: 200, y: 120 }}
        initialSize={{ w: 340, h: 440 }}
        onGeometryChange={g => { void saveEditorSetting('animation', g) }}
      >
        <div>body</div>
      </FloatingPanel>,
    )
    fireEvent.mouseDown(dragHandle(), { clientX: 250, clientY: 140 })
    fireEvent.mouseMove(window, { clientX: 300, clientY: 170 }) // +50, +30 → (250,150)
    fireEvent.mouseUp(window)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/editor_settings/animation')
    expect(opts.method).toBe('PUT')
    expect(JSON.parse(opts.body)).toEqual({ value: { x: 250, y: 150, w: 340, h: 440 } })

    global.fetch = origFetch
  })
})


/**
 * A PANEL IS AS TALL AS WHAT IS IN IT.
 *
 * The ask: every modal grows to its content height, capped at the room between the top bar and the view bar,
 * and scrolls inside only past that. So a panel writes NO inline height until someone drags the grip, which
 * is what lets the stylesheet's `height:max-content` decide. A remembered 0 is how "never resized" survives a
 * save: moving a panel persists its geometry too, and writing the drawn height there would freeze it.
 */
describe('FloatingPanel grows to its content until it is resized', () => {
  it('writes no height of its own when none was remembered', () => {
    render(
      <FloatingPanel title="Settings" onClose={() => {}} initialPos={{ x: 10, y: 10 }} initialSize={{ w: 340, h: 0 }}>
        <div>body</div>
      </FloatingPanel>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.style.height).toBe('')
    expect(dialog.style.width).toBe('340px') // the width still is the panel's own
  })

  it('and none either when it is given no size at all', () => {
    render(
      <FloatingPanel title="Settings" onClose={() => {}} initialPos={{ x: 10, y: 10 }}>
        <div>body</div>
      </FloatingPanel>,
    )
    expect(screen.getByRole('dialog').style.height).toBe('')
  })

  it('caps itself at the room between the editor bars, as a custom property the stylesheet reads', () => {
    render(
      <FloatingPanel title="Settings" onClose={() => {}} initialPos={{ x: 10, y: 10 }}>
        <div>body</div>
      </FloatingPanel>,
    )
    const cap = screen.getByRole('dialog').style.getPropertyValue('--mw-cap')
    expect(cap).toMatch(/^\d+px$/)
    expect(parseInt(cap, 10)).toBeLessThanOrEqual(window.innerHeight)
  })

  it('MOVING one keeps it content-height: the saved height stays 0', () => {
    const onGeometryChange = jest.fn()
    render(
      <FloatingPanel title="Settings" onClose={() => {}} initialPos={{ x: 200, y: 120 }} initialSize={{ w: 340, h: 0 }} onGeometryChange={onGeometryChange}>
        <div>body</div>
      </FloatingPanel>,
    )
    fireEvent.mouseDown(dragHandle(), { clientX: 250, clientY: 140 })
    fireEvent.mouseMove(window, { clientX: 300, clientY: 170 })
    fireEvent.mouseUp(window)
    expect(onGeometryChange).toHaveBeenCalledWith({ x: 250, y: 150, w: 340, h: 0 })
  })

  it('DRAGGING THE GRIP pins a height, which is then the one it draws and remembers', () => {
    const onGeometryChange = jest.fn()
    render(
      <FloatingPanel title="Settings" onClose={() => {}} initialPos={{ x: 100, y: 100 }} initialSize={{ w: 340, h: 0 }} onGeometryChange={onGeometryChange}>
        <div>body</div>
      </FloatingPanel>,
    )
    fireEvent.mouseDown(resizeGrip(), { clientX: 440, clientY: 540 })
    fireEvent.mouseMove(window, { clientX: 500, clientY: 640 })
    fireEvent.mouseUp(window)
    const geometry = onGeometryChange.mock.calls[0][0]
    expect(geometry.h).toBeGreaterThan(0)
    expect(screen.getByRole('dialog').style.height).toBe(`${geometry.h}px`)
  })
})
