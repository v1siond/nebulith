/**
 * FloatingPanel GEOMETRY persistence — the user's ask: "move and resize [the modals] at will and I want
 * to save the position, size, as settings for the editor in the elixir backend."
 *
 * We drive the REAL FloatingPanel and assert:
 *   • it restores saved geometry on open (initialPos/initialSize come from the backend map),
 *   • it emits the FINAL geometry once at the END of a drag / resize (so the page can persist it),
 *   • the geometry ROUND-TRIPS to the editor-settings API — a drag PUTs {value:{x,y,w,h}} to
 *     /editor_settings/:key (fetch mocked), exactly what nebulith stores + restores.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FloatingPanel } from '@/components/game/modals'
import { saveEditorSetting } from '@/lib/editorSettings'

const dragHandle = () => screen.getByRole('dialog').querySelector('[data-drag-handle]') as HTMLElement
const resizeGrip = () => screen.getByRole('dialog').querySelector('[data-resize-handle]') as HTMLElement

describe('FloatingPanel — geometry restore + persist', () => {
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
