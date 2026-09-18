import { useEffect, useRef, useState } from 'react'

/** Samples frames-per-second via requestAnimationFrame, refreshing ~once per second.
 *  Shared by the game-engine editor's top-nav readout (edit/show) and its play-mode floating box (#86). */
/** Frames the engine COULD draw per second, from the work one frame actually costs.
 *
 *  `useFps` counts requestAnimationFrame callbacks, and the browser locks rAF to the DISPLAY REFRESH RATE, *  on a 60Hz monitor it can never read above 60 no matter how much headroom the renderer has. So the frame
 *  rate alone cannot answer "is this fast?". Render MILLISECONDS can: 3.1ms of work is ~320 fps of capability
 *  even while the screen honestly shows 60. Returns 0 when nothing has been measured yet (never Infinity). */
export function headroomFps(renderMs: number): number {
  if (renderMs <= 0) return 0
  return Math.round(1000 / renderMs)
}

/** The probe each renderer writes its rolling per-frame cost to (see iso.ts / topdown.ts). */
export type RenderMsProbe = '__isoRenderMs' | '__2dRenderMs'

/** Poll the ACTIVE view's render-cost probe. Only the running renderer updates its own probe, so the caller
 *  passes the one matching the current view, reading the other would report a stale number from a view that
 *  is not drawing. 0 until a frame has been measured, which hides the headroom rather than faking one. */
export function useRenderMs(probe: RenderMsProbe): number {
  const [ms, setMs] = useState(0)
  useEffect(() => {
    const read = () => setMs((window as unknown as Record<string, number | undefined>)[probe] ?? 0)
    read()
    const id = setInterval(read, 500)
    return () => clearInterval(id)
  }, [probe])
  return ms
}

export function useFps(): number {
  const [fps, setFps] = useState(0)
  const frames = useRef(0)
  const last = useRef(0)
  useEffect(() => {
    let raf = 0
    last.current = performance.now()
    const tick = () => {
      frames.current++
      const now = performance.now()
      const delta = now - last.current
      if (delta >= 1000) {
        setFps(Math.round((frames.current * 1000) / delta))
        frames.current = 0
        last.current = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return fps
}
