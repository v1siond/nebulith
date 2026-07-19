import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { DayNight } from '@/engine/render'
import { getEditorSettings, saveEditorSetting, type EditorSettings, type PanelGeometry } from '@/lib/editorSettings'

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

/** The FloatingPanel props for one panel: its restored geometry (or `def`) + a persist callback. */
type FloatingPanelProps = {
  initialPos: { x: number; y: number } | undefined
  initialSize: { w: number; h: number } | undefined
  onGeometryChange: (geometry: PanelGeometry) => void
}

/**
 * Restores + persists each floating panel's position/size via nebulith (the backend owns it — geometry is
 * never hardcoded in the frontend). Loads the whole map once on mount; the returned `floatingProps(key, def)`
 * yields the FloatingPanel props for one panel and debounces a save on every move/resize END.
 * Lifted verbatim out of TemplateEditor.
 */
export function useFloatingPanels(): (key: string, def?: { w: number; h: number }) => FloatingPanelProps {
  const [panelGeo, setPanelGeo] = useState<EditorSettings>({})
  const panelGeoTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  useEffect(() => { getEditorSettings().then(setPanelGeo).catch(err => console.warn('Failed to load editor settings', err)) }, [])
  const savePanelGeo = useCallback((key: string, geometry: PanelGeometry) => {
    setPanelGeo(prev => ({ ...prev, [key]: geometry }))
    clearTimeout(panelGeoTimers.current[key])
    panelGeoTimers.current[key] = setTimeout(() => { void saveEditorSetting(key, geometry).catch(err => console.warn('Failed to save editor setting', key, err)) }, 350)
  }, [])
  return useCallback((key: string, def?: { w: number; h: number }): FloatingPanelProps => {
    const g = panelGeo[key]
    return {
      initialPos: g ? { x: g.x, y: g.y } : undefined,
      initialSize: g ? { w: g.w, h: g.h } : def,
      onGeometryChange: (geometry: PanelGeometry) => savePanelGeo(key, geometry),
    }
  }, [panelGeo, savePanelGeo])
}
