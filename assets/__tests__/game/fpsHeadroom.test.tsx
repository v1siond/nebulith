/**
 * FPS HEADROOM — "we need to be able to see fps over 60, right now seems it's limited to that".
 *
 * `useFps` counts requestAnimationFrame callbacks, and rAF is locked to the DISPLAY REFRESH RATE. On the
 * user's 60Hz monitor that number physically cannot exceed 60 however fast the engine gets — so a steady "60"
 * says nothing about whether there is room to spare. Nothing in our code throttles it; the browser does.
 *
 * The number that DOES answer "is the engine fast?" is the real work per frame (`isoRenderMsEMA`, already
 * measured and exposed as window.__isoRenderMs). 3.1ms of work = ~320 fps of capability even while the screen
 * honestly shows 60. So the readout reports BOTH: the true frame rate, and the headroom behind it.
 */
import { render, screen, renderHook, act } from '@testing-library/react'
import { FpsReadout } from '@/components/game/editorChrome'
import { headroomFps, useRenderMs } from '@/components/useFps'

describe('useRenderMs — samples the ACTIVE view\'s render-cost probe', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  it('reads the iso probe the iso renderer writes each frame', () => {
    ;(window as unknown as { __isoRenderMs?: number }).__isoRenderMs = 4.2
    const { result } = renderHook(() => useRenderMs('__isoRenderMs'))

    act(() => { jest.advanceTimersByTime(1000) })

    expect(result.current).toBeCloseTo(4.2)
  })

  it('reads the 2D probe when the 2D view is active — each view measures its own renderer', () => {
    ;(window as unknown as { __2dRenderMs?: number }).__2dRenderMs = 9.5
    const { result } = renderHook(() => useRenderMs('__2dRenderMs'))

    act(() => { jest.advanceTimersByTime(1000) })

    expect(result.current).toBeCloseTo(9.5)
  })

  it('stays 0 when the probe was never written (no frame measured → no headroom shown)', () => {
    delete (window as unknown as { __isoRenderMs?: number }).__isoRenderMs
    const { result } = renderHook(() => useRenderMs('__isoRenderMs'))

    act(() => { jest.advanceTimersByTime(1000) })

    expect(result.current).toBe(0)
  })
})

describe('headroomFps — frames the engine COULD draw, from the work it actually does', () => {
  it('converts render milliseconds into a frame rate', () => {
    expect(headroomFps(10)).toBe(100)
    expect(headroomFps(3.125)).toBe(320)
    expect(headroomFps(16.6)).toBe(60)
  })

  it('reports 0 when no frame has been measured yet (never Infinity)', () => {
    expect(headroomFps(0)).toBe(0)
    expect(headroomFps(-1)).toBe(0)
  })

  it('is not capped by the display refresh rate — that is the whole point', () => {
    expect(headroomFps(1)).toBe(1000)
    expect(headroomFps(2)).toBeGreaterThan(60)
  })
})

describe('FpsReadout shows the headroom next to the capped frame rate', () => {
  it('renders the measured fps AND the achievable rate', () => {
    render(<FpsReadout fps={60} renderMs={3.125} variant="nav" />)

    expect(screen.getByText('60')).toBeInTheDocument()
    expect(screen.getByText(/320/)).toBeInTheDocument()
  })

  it('shows the per-frame cost so a slow frame is visible', () => {
    render(<FpsReadout fps={60} renderMs={3.125} variant="nav" />)

    expect(screen.getByText(/3\.1\s*ms/)).toBeInTheDocument()
  })

  it('omits the headroom entirely when nothing has been measured', () => {
    render(<FpsReadout fps={60} renderMs={0} variant="nav" />)

    expect(screen.queryByText(/ms/)).not.toBeInTheDocument()
  })

  it('still renders without a renderMs prop (the old call sites keep working)', () => {
    render(<FpsReadout fps={42} variant="floating" />)

    expect(screen.getByText('42')).toBeInTheDocument()
  })
})
