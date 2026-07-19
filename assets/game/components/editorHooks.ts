import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { DayNight } from '@/engine/render'

/**
 * Day/Night state for the editor. The RAF render loop reads `dayNightRef` each frame (so it never
 * re-subscribes), while `dayNight` drives the controls; the ref is kept in sync on every change.
 * Lifted verbatim out of TemplateEditor — behaviour is identical to the inline state+ref+effect.
 */
export function useDayNight(initial: DayNight = 'day'): {
  dayNight: DayNight
  setDayNight: Dispatch<SetStateAction<DayNight>>
  dayNightRef: MutableRefObject<DayNight>
} {
  const [dayNight, setDayNight] = useState<DayNight>(initial)
  const dayNightRef = useRef<DayNight>(initial)
  useEffect(() => {
    dayNightRef.current = dayNight
  }, [dayNight])
  return { dayNight, setDayNight, dayNightRef }
}

/**
 * True when the viewport is phone-width (below `breakpoint`, default 768px). Recomputes on window
 * resize and cleans up its listener. Lifted verbatim out of TemplateEditor.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < breakpoint)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [breakpoint])
  return isMobile
}
