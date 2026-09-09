import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { DayNight } from '@/engine/render'
import { getEditorSettings, readBooleanSetting, readGeometrySetting, readNumberSetting, saveEditorSetting, type EditorSettings, type PanelGeometry } from '@/lib/editorSettings'
import { sectionIsOpen, sectionSettingKey, type InspectorSectionId } from '@/game/editor/inspectorSections'
import { EMPTY_GENERATOR_CATALOG, fetchGeneratorCatalog, type GeneratorCatalog } from '@/lib/generatorCatalog'
import type { SaveState } from '@/game/editor/saveState'

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
    const g = readGeometrySetting(panelGeo, key) // a malformed row must not place a panel off-screen
    return {
      initialPos: g ? { x: g.x, y: g.y } : undefined,
      initialSize: g ? { w: g.w, h: g.h } : def,
      onGeometryChange: (geometry: PanelGeometry) => savePanelGeo(key, geometry),
    }
  }, [panelGeo, savePanelGeo])
}

/**
 * Tracks whether the open map has unsaved edits, and how long ago it was saved (§4.4).
 *
 * The editor already announces every map mutation — it takes an undo CHECKPOINT before each one — so
 * `markEdited` rides that same seam rather than inventing a second notion of "changed". Loading a template
 * clears the flag (a freshly loaded map is exactly what the server holds); a successful save clears it and
 * stamps the time.
 */
export function useSaveState(): {
  saveState: SaveState
  markEdited: () => void
  markSaving: () => void
  markSaved: () => void
  markLoaded: () => void
  /** Live for the render loop / a switch guard, without waiting for a re-render. */
  saveStateRef: MutableRefObject<SaveState>
} {
  const [saveState, setSaveState] = useState<SaveState>({ dirty: false, saving: false, savedAt: null })
  const saveStateRef = useRef<SaveState>(saveState)
  useEffect(() => { saveStateRef.current = saveState }, [saveState])

  const markEdited = useCallback(() => setSaveState(s => (s.dirty ? s : { ...s, dirty: true })), [])
  const markSaving = useCallback(() => setSaveState(s => ({ ...s, saving: true })), [])
  const markSaved = useCallback(() => setSaveState({ dirty: false, saving: false, savedAt: Date.now() }), [])
  // A load replaces the map with exactly what the server holds, so it is clean — and `savedAt` is null
  // rather than "now": the user has not saved THIS session, and claiming they did would be a lie the status
  // line then repeats.
  const markLoaded = useCallback(() => setSaveState({ dirty: false, saving: false, savedAt: null }), [])

  return { saveState, markEdited, markSaving, markSaved, markLoaded, saveStateRef }
}

/** The key the player camera range persists under. */
const PLAYER_RANGE_KEY = 'playerViewRange'

/**
 * The PLAYER CAMERA RANGE, remembered across reloads (§5.1 #7 / §3.15).
 *
 * `templates.tsx` carried "Not persisted yet — a follow-up" since the control was added: the settings store
 * was typed to panel geometry, so a plain number had nowhere to live. It does now.
 *
 * Tri-state on purpose: `undefined` = OFF (render the whole window, today's default), a number = cull to
 * that radius. A load failure leaves it OFF rather than guessing a radius — an invented cull would hide
 * parts of the map the user never asked to hide.
 */
export function usePlayerViewRange(): {
  playerViewRange: number | undefined
  setPlayerViewRange: (range: number | undefined) => void
  playerViewRangeRef: MutableRefObject<number | undefined>
} {
  const [playerViewRange, setRange] = useState<number | undefined>(undefined)
  const playerViewRangeRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    let live = true
    getEditorSettings()
      .then(settings => { if (live) setRange(readNumberSetting(settings, PLAYER_RANGE_KEY)) })
      .catch(err => console.warn('Failed to load the player view range', err))
    return () => { live = false }
  }, [])

  useEffect(() => { playerViewRangeRef.current = playerViewRange }, [playerViewRange])

  // Write through on every change. `null` records "the user turned it OFF" — distinct from never set, so a
  // reload does not resurrect a range they deliberately cleared.
  const setPlayerViewRange = useCallback((range: number | undefined) => {
    setRange(range)
    void saveEditorSetting(PLAYER_RANGE_KEY, { value: range ?? null })
      .catch(err => console.warn('Failed to save the player view range', err))
  }, [])

  return { playerViewRange, setPlayerViewRange, playerViewRangeRef }
}

/**
 * Which inspector sections are open (§4.7, Week 5) — remembered in the backend's editor-settings store.
 *
 * The state is deliberately SPARSE: only sections the user has actually toggled get a row. Everything else
 * reads `undefined` and falls to §4.7's designed default via `sectionIsOpen`, so shipping a change to those
 * defaults reaches everyone who never had an opinion, and nobody who did.
 *
 * Writes are optimistic — a section must open the instant it is clicked, not a network round-trip later —
 * and a failed save is warned about rather than swallowed, since the only cost is a forgotten preference.
 */
export function useInspectorSections(): {
  isOpen: (id: InspectorSectionId) => boolean
  toggle: (id: InspectorSectionId) => void
} {
  const [saved, setSaved] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let live = true
    getEditorSettings()
      .then(settings => {
        if (!live) return
        const next: Record<string, boolean> = {}
        for (const key of Object.keys(settings)) {
          const value = readBooleanSetting(settings, key)
          if (value !== undefined) next[key] = value
        }
        setSaved(next)
      })
      .catch(err => console.warn('Failed to load the inspector section state', err))
    return () => { live = false }
  }, [])

  const isOpen = useCallback(
    (id: InspectorSectionId) => sectionIsOpen(id, saved[sectionSettingKey(id)]),
    [saved],
  )

  const toggle = useCallback((id: InspectorSectionId) => {
    const key = sectionSettingKey(id)
    setSaved(prev => {
      const next = !sectionIsOpen(id, prev[key])
      void saveEditorSetting(key, { value: next })
        .catch(err => console.warn('Failed to save the inspector section state', key, err))
      return { ...prev, [key]: next }
    })
  }, [])

  return { isOpen, toggle }
}

/** What the editor knows about the backend's map generators: the catalog, and whether the load failed. */
export interface GeneratorCatalogState {
  catalog: GeneratorCatalog
  /** The load failure, for the UI to SAY. Null while loading and after a successful load. */
  error: string | null
}

/**
 * Loads the backend's map-generator catalog once on mount (`GET /api/generators`, T-113 / §3.14b Tier-1 #1).
 *
 * The catalog IS the Generate menu: seasons, map types and their layouts all come from these rows, so the
 * editor offers exactly what the backend can generate. A failed load leaves the catalog EMPTY and reports
 * the reason — the menu must say the generators are unreachable, never fall back to a hardcoded list of
 * map types the backend may no longer have (the silence that hid the localStorage games P0, §3.1).
 */
export function useGeneratorCatalog(): GeneratorCatalogState {
  const [catalog, setCatalog] = useState<GeneratorCatalog>(EMPTY_GENERATOR_CATALOG)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    fetchGeneratorCatalog()
      .then(next => { if (live) { setCatalog(next); setError(null) } })
      .catch((err: unknown) => { if (live) setError(err instanceof Error ? err.message : String(err)) })
    return () => { live = false }
  }, [])
  return { catalog, error }
}
